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
// Only the simple forms compile: `styled.tag`, `styled('tag')`, `styled(Ident)`.
// Anything with a chain (`.attrs`, `.withConfig`), the helpers (`css`,
// `keyframes`, `createGlobalStyle`), css-prop, and exotic tag shapes are left
// untouched and render through real styled-components.
import syntax from '@babel/plugin-syntax-jsx'
import path from 'path'
import { addNamed, addSideEffect } from '@babel/helper-module-imports'
import { compile, serialize, stringify, middleware, prefixer } from 'stylis'
import { isStyled } from './utils/detectors'
import getName from './utils/getName'
import prefixLeadingDigit from './utils/prefixDigit'
import { getFileHash } from './utils/fileHash'
import { useDisplayName, useRuntimeImportPath, useMeaninglessFileNames, useNamespace } from './utils/options'

const CREATE_IMPORT_NAME = 'just-styled-create-name'
const PATCH_IMPORT_ADDED = 'just-styled-patch-added'
const POSITION = 'just-styled-position'

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
// member access into const objects. Anything else (prop functions, css``
// fragments, ${Component} selectors, cross-module imports) stays unresolved.
const staticValue = (t, exprPath) => {
  const ev = exprPath.evaluate()
  if (ev.confident) return { confident: true, value: ev.value }
  if (t.isMemberExpression(exprPath.node)) return resolveMember(t, exprPath)
  return { confident: false }
}

// The raw CSS body of a template if it is fully static after resolving module
// constants — i.e. every interpolation resolves to a string/number (or a falsy
// value we drop, matching the runtime). Returns null if anything is dynamic, so
// the template is left live for the runtime to resolve. Zero-interpolation
// templates are the trivial case (no expressions to resolve).
const tryStaticRaw = (t, path) => {
  const quasi = path.node.quasi
  const quasis = quasi.quasis
  const exprs = quasi.expressions
  let raw = (quasis[0] && quasis[0].value.cooked) || ''
  if (exprs.length === 0) return raw
  const exprPaths = path.get('quasi.expressions')
  for (let i = 0; i < exprs.length; i++) {
    const r = staticValue(t, exprPaths[i])
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
        const componentNode = parseSimpleTag(t, tag)
        if (!componentNode) return // chains / helpers / exotic shapes -> untouched

        const componentId = nextComponentId(state)
        const configProps = [
          t.objectProperty(t.identifier('componentId'), t.stringLiteral(componentId)),
        ]
        if (useDisplayName(state)) {
          const displayName = getDisplayName(t, path, state)
          if (displayName) {
            configProps.push(
              t.objectProperty(
                t.identifier('displayName'),
                t.stringLiteral(displayName.replace(/[^_a-zA-Z0-9-]/g, ''))
              )
            )
          }
        }

        // Build-time precompile: a template that is fully static after resolving
        // module constants (zero interpolations, or interpolations that are all
        // literals / const members) is compiled with stylis at BUILD time and the
        // finished rule emitted as `css` (registered under the componentId at
        // runtime — no runtime css()/stylis), dropping the live template body.
        // Works for any base (native tag or styled(Ident)); a styled(Ident)
        // extender's own rule is independent of its base, and the base chain is
        // ordered at render time (see registerBaseFirst), so no folding is needed.
        const raw = tryStaticRaw(t, path)
        if (raw != null) {
          const compiled = serialize(
            compile('.' + componentId + '{' + raw + '}'),
            middleware([prefixer, stringify])
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
