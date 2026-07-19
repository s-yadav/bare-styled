// just-styled transform (decoupled).
//
// The compile step's only job now: rewrite a `styled` tagged template into a
// `createStyled(component, { componentId, displayName })`...`` call, keeping the
// template's interpolations LIVE so the runtime can resolve them on first
// render. All CSS analysis (minify, static extraction, stylis) moved to the
// runtime `flatten`, so this plugin no longer forks babel-plugin-styled-
// components' heavy machinery — it just detects the styled form, generates a
// stable componentId + displayName, and injects the runtime import.
//
// The simple forms compile — `styled.tag`, `styled('tag')`, `styled(Ident)` —
// including `.attrs(...)` / `.withConfig({ componentId, displayName,
// shouldForwardProp })` chains (attrs expressions stay live; the runtime
// applies them per render with styled-components semantics). The helpers
// (`css`, `keyframes`, `createGlobalStyle`), css-prop, unknown withConfig
// options and exotic tag shapes are left untouched and render through real
// styled-components.
import syntax from '@babel/plugin-syntax-jsx'
import path from 'path'
import { addNamed, addSideEffect } from '@babel/helper-module-imports'
import { compile, serialize, stringify, middleware, prefixer } from 'stylis'
import { isStyled, isCSSHelper } from './utils/detectors'
import getName from './utils/getName'
import prefixLeadingDigit from './utils/prefixDigit'
import { getFileHash } from './utils/fileHash'
import { useDisplayName, useRuntimeImportPath, useMeaninglessFileNames, useNamespace, useVendorPrefixes } from './utils/options'

const CREATE_IMPORT_NAME = 'just-styled-create-name'
const PATCH_IMPORT_ADDED = 'just-styled-patch-added'
const POSITION = 'just-styled-position'
const STYLED_IDS = 'just-styled-component-ids' // VariableDeclarator node -> componentId

// Guard against pathological fragment-in-fragment nesting while resolving.
const MAX_STATIC_DEPTH = 8

// Unwrap TS expression wrappers that can sit between chain links or around the
// whole tag: `styled(X)<T>` / `.withConfig({...})<T>` (TSInstantiationExpression),
// `as` casts, non-null assertions, parens.
const unwrapTsWrappers = node => {
  while (
    node &&
    (node.type === 'TSInstantiationExpression' ||
      node.type === 'TSAsExpression' ||
      node.type === 'TSNonNullExpression' ||
      node.type === 'ParenthesizedExpression')
  ) {
    node = node.expression
  }
  return node
}

// Parse a full `styled...` tag chain: the innermost simple form plus any
// `.attrs(expr)` / `.withConfig({ ... })` links, in any order. Returns
// { componentNode, attrs (application order), componentId?, displayName?,
// shouldForwardProp? } or null to leave the template untouched (unknown
// withConfig keys, non-literal componentId/displayName, multiple withConfig —
// those still run on real styled-components). Kept strict and IDENTICAL to
// the fast engine's rules so both engines transform the same set.
const parseChain = (t, tagIn) => {
  let tag = unwrapTsWrappers(tagIn)
  const attrs = [] // collected outer-first, reversed below
  let withConfig = null
  while (
    t.isCallExpression(tag) &&
    t.isMemberExpression(tag.callee) &&
    !tag.callee.computed &&
    t.isIdentifier(tag.callee.property) &&
    (tag.callee.property.name === 'attrs' || tag.callee.property.name === 'withConfig') &&
    tag.arguments.length === 1
  ) {
    const arg = tag.arguments[0]
    if (tag.callee.property.name === 'attrs') {
      attrs.push(arg)
    } else {
      if (withConfig || !t.isObjectExpression(arg)) return null
      withConfig = arg
    }
    tag = unwrapTsWrappers(tag.callee.object)
  }
  const componentNode = parseSimpleTag(t, tag)
  if (!componentNode) return null

  let componentId
  let displayName
  let shouldForwardProp
  if (withConfig) {
    for (const prop of withConfig.properties) {
      if (!t.isObjectProperty(prop) || prop.computed) return null
      const key = t.isIdentifier(prop.key)
        ? prop.key.name
        : t.isStringLiteral(prop.key)
        ? prop.key.value
        : null
      if (key === 'componentId') {
        if (!t.isStringLiteral(prop.value)) return null
        componentId = prop.value.value
      } else if (key === 'displayName') {
        if (!t.isStringLiteral(prop.value)) return null
        displayName = prop.value.value
      } else if (key === 'shouldForwardProp') {
        shouldForwardProp = prop.value
      } else {
        return null // unknown withConfig option -> real styled-components
      }
    }
  }
  attrs.reverse() // AST is outermost-first; application order is chain order
  return { componentNode, attrs, componentId, displayName, shouldForwardProp }
}

// Reject anything that isn't exactly `styled.tag`, `styled('tag')`, or
// `styled(Ident)`. Returns the component node (a string literal for native
// tags, a cloned identifier for component refs) or null to leave the node be.
const parseSimpleTag = (t, tag) => {
  // styled.div
  if (
    t.isMemberExpression(tag) &&
    !tag.computed &&
    t.isIdentifier(tag.object) &&
    t.isIdentifier(tag.property)
  ) {
    return t.stringLiteral(tag.property.name)
  }
  // styled('div') | styled(Component)
  if (
    t.isCallExpression(tag) &&
    t.isIdentifier(tag.callee) &&
    tag.arguments.length === 1
  ) {
    const arg = tag.arguments[0]
    if (t.isStringLiteral(arg)) return t.stringLiteral(arg.value)
    if (t.isIdentifier(arg)) return t.cloneNode(arg, true)
  }
  return null
}

// Resolve a node to a literal value (string/number/bool/null) if it is one, or a
// const identifier / zero-expression template that transitively is one. Returns
// { ok, value } — ok:false means "not statically a simple literal".
const litValue = (t, scope, node) => {
  if (t.isStringLiteral(node) || t.isNumericLiteral(node) || t.isBooleanLiteral(node)) {
    return { ok: true, value: node.value }
  }
  if (t.isNullLiteral(node)) return { ok: true, value: null }
  if (t.isTemplateLiteral(node) && node.expressions.length === 0) {
    return { ok: true, value: node.quasis[0].value.cooked }
  }
  if (t.isIdentifier(node) && scope) {
    const binding = scope.getBinding(node.name)
    if (binding && binding.constant && binding.path.node && binding.path.node.init) {
      return litValue(t, binding.path.scope, binding.path.node.init)
    }
  }
  return { ok: false }
}

// Follow a member chain (theme.space.sm, theme['border']) into a const object
// literal and return the final literal value. Babel's own evaluate() deopts on
// member access into an object binding, so we resolve it ourselves.
const resolveMember = (t, exprPath) => {
  const keys = []
  let node = exprPath.node
  while (t.isMemberExpression(node)) {
    if (!node.computed && t.isIdentifier(node.property)) keys.unshift(node.property.name)
    else if (node.computed && t.isStringLiteral(node.property)) keys.unshift(node.property.value)
    else return { confident: false }
    node = node.object
  }
  if (!t.isIdentifier(node)) return { confident: false }
  const binding = exprPath.scope.getBinding(node.name)
  if (!binding || !binding.constant || !binding.path.node) return { confident: false }
  let cur = binding.path.node.init
  const declScope = binding.path.scope
  for (const key of keys) {
    if (!t.isObjectExpression(cur)) return { confident: false }
    let next
    for (const prop of cur.properties) {
      if (!t.isObjectProperty(prop) || prop.computed) continue
      const name = t.isIdentifier(prop.key) ? prop.key.name : t.isStringLiteral(prop.key) ? prop.key.value : null
      if (name === key) { next = prop.value; break }
    }
    if (next === undefined) return { confident: false }
    cur = next
  }
  const lit = litValue(t, declScope, cur)
  return lit.ok ? { confident: true, value: lit.value } : { confident: false }
}

// Statically resolve one interpolation. Babel's evaluate() covers literals, const
// identifiers, string concat and conditionals of consts; resolveMember covers
// member access into const objects; same-file `${Component}` selectors resolve to
// the componentId marker the plugin just minted (matching the runtime's
// descriptor toString), and same-file fully-static css`` fragments inline to
// their raw text (matching the runtime's flatten-then-join). Anything else
// (prop functions, dynamic fragments, cross-module imports) stays unresolved.
const staticValue = (t, exprPath, state, depth) => {
  const ev = exprPath.evaluate()
  if (ev.confident) return { confident: true, value: ev.value }
  if (t.isMemberExpression(exprPath.node)) return resolveMember(t, exprPath)
  if (t.isIdentifier(exprPath.node) && depth < MAX_STATIC_DEPTH) {
    const binding = exprPath.scope.getBinding(exprPath.node.name)
    if (binding && binding.constant && binding.path.isVariableDeclarator()) {
      // ${Component}: a styled component this plugin already transformed in
      // this file -> `.componentId` selector, exactly what the runtime's css()
      // flatten produces from the descriptor's toString.
      const ids = state.file.get(STYLED_IDS)
      const componentId = ids && ids.get(binding.path.node)
      if (componentId) return { confident: true, value: '.' + componentId }
      // ${fragment}: a same-file css`` fragment whose own template is fully
      // static -> inline its raw text (the runtime flattens it to strings and
      // joins them). Dynamic fragments bail and stay live.
      const init = binding.path.node.init
      if (
        t.isTaggedTemplateExpression(init) &&
        isCSSHelper(t)(init.tag, state)
      ) {
        const raw = staticRawOfTemplate(t, binding.path.get('init'), state, depth + 1)
        if (raw != null) return { confident: true, value: raw }
      }
    }
  }
  return { confident: false }
}

// The raw CSS body of a tagged-template path if it is fully static after
// resolving module constants — i.e. every interpolation resolves to a
// string/number (or a falsy value we drop, matching the runtime). Returns null
// if anything is dynamic, so the template is left live for the runtime to
// resolve. Zero-interpolation templates are the trivial case. Also used
// recursively (via staticValue) to inline same-file css`` fragments.
const staticRawOfTemplate = (t, path, state, depth) => {
  const quasi = path.node.quasi
  const quasis = quasi.quasis
  const exprs = quasi.expressions
  // A quasi containing an invalid JS escape (e.g. content:'\2022' — CSS escapes
  // need a doubled backslash in a template) has a nullish `cooked` (babel uses
  // null, ESTree undefined). Bail to the live template rather than silently
  // dropping that chunk of CSS.
  for (let i = 0; i < quasis.length; i++) {
    if (quasis[i].value.cooked == null) return null
  }
  let raw = (quasis[0] && quasis[0].value.cooked) || ''
  if (exprs.length === 0) return raw
  const exprPaths = path.get('quasi.expressions')
  for (let i = 0; i < exprs.length; i++) {
    const r = staticValue(t, exprPaths[i], state, depth)
    if (!r.confident) return null
    const v = r.value
    let piece
    if (typeof v === 'string') piece = v
    else if (typeof v === 'number') piece = String(v)
    else if (v === false || v === null || v === undefined || v === '') piece = '' // runtime drops falsy
    else return null // object / array / true / anything else -> leave live to match runtime exactly
    raw += piece + ((quasis[i + 1] && quasis[i + 1].value.cooked) || '')
  }
  return raw
}

const tryStaticRaw = (t, path, state) => staticRawOfTemplate(t, path, state, 0)

const getBlockName = (file, meaningless) => {
  const name = path.basename(file.opts.filename, path.extname(file.opts.filename))
  return meaningless.includes(name)
    ? path.basename(path.dirname(file.opts.filename))
    : name
}

const getDisplayName = (t, componentPath, state) => {
  const componentName = getName(t)(componentPath)
  const file = state.file
  if (!file || !file.opts.filename) return componentName
  const blockName = getBlockName(file, useMeaninglessFileNames(state))
  if (blockName === componentName) return componentName
  return componentName
    ? `${prefixLeadingDigit(blockName)}__${componentName}`
    : prefixLeadingDigit(blockName)
}

const nextComponentId = state => {
  const id = state.file.get(POSITION) || 0
  state.file.set(POSITION, id + 1)
  return `${useNamespace(state)}sc-${getFileHash(state)}-${id}`
}

export default function ({ types: t }) {
  return {
    inherits: syntax,
    visitor: {
      TaggedTemplateExpression(path, state) {
        const tag = path.node.tag
        if (!isStyled(t)(tag, state)) return
        const parsed = parseChain(t, tag)
        if (!parsed) return // helpers / exotic shapes / unknown withConfig -> untouched
        const { componentNode, attrs, shouldForwardProp } = parsed

        // withConfig componentId wins over the minted one (styled-components
        // semantics); minting only happens when actually needed so positions
        // stay stable.
        const componentId = parsed.componentId || nextComponentId(state)

        // Record `const Name = styled...` -> componentId (keyed by the
        // declarator node, so shadowing can't confuse the lookup). Later
        // templates in this file can then resolve `${Name}` at build time.
        if (
          path.parentPath.isVariableDeclarator() &&
          t.isIdentifier(path.parentPath.node.id)
        ) {
          let ids = state.file.get(STYLED_IDS)
          if (!ids) {
            ids = new Map()
            state.file.set(STYLED_IDS, ids)
          }
          ids.set(path.parentPath.node, componentId)
        }

        const configProps = [
          t.objectProperty(t.identifier('componentId'), t.stringLiteral(componentId)),
        ]
        if (useDisplayName(state)) {
          const displayName = parsed.displayName || getDisplayName(t, path, state)
          if (displayName) {
            configProps.push(
              t.objectProperty(
                t.identifier('displayName'),
                t.stringLiteral(displayName.replace(/[^_a-zA-Z0-9-]/g, ''))
              )
            )
          }
        }
        // .attrs(...) chain: the expressions stay LIVE (evaluated at module
        // scope inside the config), in application order; the runtime applies
        // them per render with styled-components semantics.
        if (attrs.length) {
          configProps.push(
            t.objectProperty(
              t.identifier('attrs'),
              t.arrayExpression(attrs.map(a => t.cloneNode(a, true)))
            )
          )
        }
        if (shouldForwardProp) {
          configProps.push(
            t.objectProperty(
              t.identifier('shouldForwardProp'),
              t.cloneNode(shouldForwardProp, true)
            )
          )
        }

        // Build-time precompile: a template that is fully static after resolving
        // module constants (zero interpolations, or interpolations that are all
        // literals / const members / same-file `${Component}` selectors /
        // same-file static css`` fragments) is compiled with stylis at BUILD
        // time and the finished rule emitted as `css` (registered under the
        // componentId at runtime — no runtime css()/stylis), dropping the live
        // template body. Works for any base (native tag or styled(Ident)); a
        // styled(Ident) extender's own rule is independent of its base, and the
        // sheet's group ordering (definition order) puts base rules before
        // extender rules, so no folding is needed. Vendor prefixing is opt-in
        // (SC v6 parity).
        const raw = tryStaticRaw(t, path, state)
        if (raw != null) {
          const compiled = serialize(
            compile('.' + componentId + '{' + raw + '}'),
            middleware(useVendorPrefixes(state) ? [prefixer, stringify] : [stringify])
          )
          configProps.push(t.objectProperty(t.identifier('css'), t.stringLiteral(compiled)))
          path.node.quasi = t.templateLiteral([t.templateElement({ raw: '', cooked: '' })], [])
        }

        const runtimeImportPath = useRuntimeImportPath(state)
        let createName = state.file.get(CREATE_IMPORT_NAME)
        if (!createName) {
          createName = addNamed(path, 'createStyled', runtimeImportPath, {
            nameHint: 'createStyled',
          }).name
          state.file.set(CREATE_IMPORT_NAME, createName)
        }
        if (!state.file.get(PATCH_IMPORT_ADDED)) {
          addSideEffect(path, `${runtimeImportPath}/patch`)
          state.file.set(PATCH_IMPORT_ADDED, true)
        }

        // Rewrite the tag; the quasi (with live interpolations) stays intact.
        path.node.tag = t.callExpression(t.identifier(createName), [
          componentNode,
          t.objectExpression(configProps),
        ])
      },
    },
  }
}
