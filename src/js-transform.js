// bare-styled babel transform: rewrite a `styled` tagged template into a
// `createStyled(component, config)`...`` call, precompiling what it can
// (static/skeleton) and keeping the rest live. Simple forms compile —
// styled.tag / styled('tag') / styled(Ident) plus .attrs/.withConfig chains;
// helpers (css, keyframes, createGlobalStyle), css-prop, unknown withConfig
// options and exotic shapes stay untouched on real styled-components.
import syntax from '@babel/plugin-syntax-jsx'
import path from 'path'
import { addNamed, addSideEffect } from '@babel/helper-module-imports'
import { compile, serialize, stringify, middleware, prefixer } from 'stylis'
import { isStyled, isCSSHelper } from './utils/detectors'
import { createScanner } from './utils/value-positions'
import getName from './utils/getName'
import prefixLeadingDigit from './utils/prefixDigit'
import { getFileHash } from './utils/fileHash'
import { useDisplayName, useRuntimeImportPath, useMeaninglessFileNames, useNamespace, useVendorPrefixes } from './utils/options'

const CREATE_IMPORT_NAME = 'bare-styled-create-name'
const PATCH_IMPORT_ADDED = 'bare-styled-patch-added'
const POSITION = 'bare-styled-position'
const STYLED_IDS = 'bare-styled-component-ids' // VariableDeclarator node -> componentId

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

// Parse a `styled...` chain (simple form + .attrs/.withConfig links). Returns
// the parsed config or null to leave the template untouched. Bail rules kept
// strict and IDENTICAL to the fast engine's so both transform the same set.
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
  let forwardProps
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
      } else if (key === 'forwardProps') {
        // bare-styled extension: one call shaping all element props
        forwardProps = prop.value
      } else {
        return null // unknown withConfig option -> real styled-components
      }
    }
  }
  attrs.reverse() // AST is outermost-first; application order is chain order
  return { componentNode, attrs, componentId, displayName, shouldForwardProp, forwardProps }
}

// A non-computed identifier chain: Dropdown.Item, A.B.C.
const isSimpleMemberChain = (t, node) => {
  while (t.isMemberExpression(node) && !node.computed && t.isIdentifier(node.property)) {
    node = node.object
  }
  return t.isIdentifier(node)
}

// Reject anything that isn't `styled.tag`, `styled('tag')`, `styled(Ident)`,
// or `styled(Compound.Member)` (TS wrappers around the argument — e.g.
// `styled(Tree<T>)` — are unwrapped). Returns the component node or null.
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
  // styled('div') | styled(Component) | styled(Compound.Member) | styled(Comp<T>)
  if (
    t.isCallExpression(tag) &&
    t.isIdentifier(tag.callee) &&
    tag.arguments.length === 1
  ) {
    const arg = unwrapTsWrappers(tag.arguments[0])
    if (t.isStringLiteral(arg)) return t.stringLiteral(arg.value)
    if (t.isIdentifier(arg)) return t.cloneNode(arg, true)
    if (isSimpleMemberChain(t, arg)) return t.cloneNode(arg, true)
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

// Statically resolve one interpolation: babel evaluate(), member access into
// const objects, same-file `${Component}` selectors (-> componentId marker),
// same-file static css`` fragments (inlined). Anything else stays unresolved.
const staticValue = (t, exprPath, state, depth) => {
  const ev = exprPath.evaluate()
  if (ev.confident) return { confident: true, value: ev.value }
  if (t.isMemberExpression(exprPath.node)) return resolveMember(t, exprPath)
  if (t.isIdentifier(exprPath.node) && depth < MAX_STATIC_DEPTH) {
    const binding = exprPath.scope.getBinding(exprPath.node.name)
    if (binding && binding.constant && binding.path.isVariableDeclarator()) {
      // ${Component} already transformed in this file -> `.componentId`
      // selector (matches the runtime descriptor's toString).
      const ids = state.file.get(STYLED_IDS)
      const componentId = ids && ids.get(binding.path.node)
      if (componentId) return { confident: true, value: '.' + componentId }
      // Same-file fully-static css`` fragment -> inline its raw text.
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

// Raw CSS body of a template if fully static (every interpolation resolves to
// string/number, or a falsy value we drop like the runtime does); null if
// anything is dynamic. Also used recursively to inline css`` fragments.
const staticRawOfTemplate = (t, path, state, depth) => {
  const quasi = path.node.quasi
  const quasis = quasi.quasis
  const exprs = quasi.expressions
  // Invalid JS escape (e.g. content:'\2022') -> nullish cooked; bail to live
  // rather than silently dropping that chunk of CSS.
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

// Template analysis. Outcomes: 'static' (all resolved — precompile whole
// rule), 'skeleton' (residuals only in declaration VALUE slots -> var(--bs-N)
// placeholders; structure fixed, stylis runs at build), 'live' (residual in
// block/selector position — structure can change per render).
const analyzeTemplate = (t, path, state) => {
  const quasi = path.node.quasi
  const quasis = quasi.quasis
  const exprs = quasi.expressions
  for (let i = 0; i < quasis.length; i++) {
    if (quasis[i].value.cooked == null) return { kind: 'live' } // invalid escape
  }
  const exprPaths = exprs.length ? path.get('quasi.expressions') : []
  const scanner = createScanner()
  let raw = (quasis[0] && quasis[0].value.cooked) || ''
  scanner.feed(raw)
  const vars = []
  for (let i = 0; i < exprs.length; i++) {
    const r = staticValue(t, exprPaths[i], state, 0)
    if (r.confident) {
      const v = r.value
      let piece
      if (typeof v === 'string') piece = v
      else if (typeof v === 'number') piece = String(v)
      else if (v === false || v === null || v === undefined || v === '') piece = ''
      else return { kind: 'live' } // object/array/true -> match runtime semantics
      raw += piece
      scanner.feed(piece)
    } else if (scanner.inValue()) {
      raw += 'var(--bs-' + vars.length + ')'
      vars.push(exprPaths[i].node)
      // a value token was emitted; scanner state stays "in value"
    } else {
      return { kind: 'live' } // block/selector-position residual
    }
    const nxt = (quasis[i + 1] && quasis[i + 1].value.cooked) || ''
    raw += nxt
    scanner.feed(nxt)
  }
  if (vars.length === 0) return { kind: 'static', raw }
  return { kind: 'skeleton', raw, vars }
}

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
        const { componentNode, attrs, shouldForwardProp, forwardProps } = parsed

        // withConfig componentId wins over the minted one (SC semantics).
        const componentId = parsed.componentId || nextComponentId(state)

        // Record `const Name = styled...` -> componentId (keyed by declarator
        // node so shadowing can't confuse later `${Name}` resolution).
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
        // attrs expressions stay LIVE, in application order; the runtime
        // applies them per render.
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
        if (forwardProps) {
          configProps.push(
            t.objectProperty(t.identifier('forwardProps'), t.cloneNode(forwardProps, true))
          )
        }

        // Build-time compilation (vendor prefixing opt-in, SC v6 parity):
        // static ships a finished `css` rule; skeleton runs stylis HERE over a
        // .__bsc__ token and ships `skeleton` + `vars` (live expressions in
        // placeholder order); live keeps the template for the runtime flatten.
        const mw = middleware(useVendorPrefixes(state) ? [prefixer, stringify] : [stringify])
        const analysis = analyzeTemplate(t, path, state)
        if (analysis.kind === 'static') {
          const compiled = serialize(compile('.' + componentId + '{' + analysis.raw + '}'), mw)
          configProps.push(t.objectProperty(t.identifier('css'), t.stringLiteral(compiled)))
          path.node.quasi = t.templateLiteral([t.templateElement({ raw: '', cooked: '' })], [])
        } else if (analysis.kind === 'skeleton') {
          const compiled = serialize(compile('.__bsc__{' + analysis.raw + '}'), mw)
          configProps.push(t.objectProperty(t.identifier('skeleton'), t.stringLiteral(compiled)))
          configProps.push(
            t.objectProperty(
              t.identifier('vars'),
              t.arrayExpression(analysis.vars.map(v => t.cloneNode(v, true)))
            )
          )
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
