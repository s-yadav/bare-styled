// createElement patch implementation.
// CommonJS on purpose: this package ships source, and consumers (jest,
// bundlers, node) all load it without a transform step. It also lets the
// jsx-runtime modules be required lazily inside try/catch.
'use strict'

const React = require('react')
const isPropValid = require('@emotion/is-prop-valid').default

// Same global-registry symbol as index.js. Defined locally to keep this
// module free of require cycles.
const IS_STYLED = Symbol.for('just-styled')

let installed = false
let patchedEntries = null

// Registry backing the sc-inline hack for styled(Component) descriptors.
// Entries are written when a descriptor wraps a component ref and consumed
// (delete on read) when the forwarded className reaches a native element in
// the same render pass. The size cap guards against leaks when a wrapper
// never renders a native node; eviction drops the oldest entry.
const INLINE_REGISTRY_CAP = 10000
const inlineRegistry = new Map()
let nextInlineId = 0

const SC_INLINE_TOKEN = /(?:^|\s)sc-inline-(\d+)(?=\s|$)/g

function registerInlineStyles(styles) {
  if (inlineRegistry.size >= INLINE_REGISTRY_CAP) {
    inlineRegistry.delete(inlineRegistry.keys().next().value)
  }
  const id = nextInlineId++
  inlineRegistry.set(id, styles)
  return id
}

// A descriptor carries IS_STYLED, but so does a real styled component that
// wraps one: styled-components hoists the target's own properties, symbols
// included, onto the wrapper via hoist-non-react-statics. The discriminator is
// a self-reference — a genuine descriptor sets `element[IS_STYLED] = element`,
// so `type[IS_STYLED] === type`. Hoisting copies that value by reference, so on
// a wrapper `wrapper[IS_STYLED]` still points at the original descriptor and
// the identity check fails, marking the wrapper as not-a-descriptor (it must
// render through styled-components untouched). This survives the descriptor
// now carrying a `styledComponentId`.
function isDescriptor(type) {
  return Boolean(type && type[IS_STYLED] === type)
}

// Props kept on native tags regardless of what @emotion/is-prop-valid says.
function isAlwaysKept(key) {
  return (
    key === 'className' ||
    key === 'style' ||
    key === 'children' ||
    key === 'key' ||
    key === 'ref' ||
    key.indexOf('data-') === 0 ||
    key.indexOf('aria-') === 0
  )
}

// Descriptor over a native tag: merge the static className, turn dynamic
// interpolations into inline css variables (user style wins on conflicts),
// and drop props that are not valid DOM attributes.
function buildDomProps(desc, props) {
  const next = {}
  if (props) {
    for (const key in props) {
      if (isAlwaysKept(key) || isPropValid(key)) next[key] = props[key]
    }
  }
  next.className =
    props && props.className
      ? desc.className + ' ' + props.className
      : desc.className
  const style = Object.assign(
    desc.getInlineStyles(props || {}),
    props && props.style
  )
  for (const key in style) {
    next.style = style
    break
  }
  return next
}

// Strips sc-inline tokens out of a native element's className and merges the
// matching registry entries into its style. The element's own style wins.
function consumeInlineStyles(props) {
  const collected = {}
  let hasCollected = false
  const className = props.className
    .replace(SC_INLINE_TOKEN, (match, id) => {
      const entry = inlineRegistry.get(Number(id))
      if (entry) {
        inlineRegistry.delete(Number(id))
        Object.assign(collected, entry)
        hasCollected = true
      }
      return ''
    })
    .replace(/\s{2,}/g, ' ')
    .trim()
  const next = Object.assign({}, props, { className })
  if (hasCollected) next.style = Object.assign(collected, props.style)
  return next
}

// Rewrites a (type, props) pair when the patch has work to do, or returns
// null so the caller can hand the original arguments straight through.
function resolve(type, props) {
  if (isDescriptor(type)) {
    // `as` and `theme` need styled-components' full machinery, so those
    // renders delegate to the memoized fallback component.
    if (props && ('as' in props || 'theme' in props)) {
      return { type: type.getStyledComponent(), props }
    }
    if (typeof type.component === 'string') {
      const domProps = buildDomProps(type, props)
      // A forwarded className can carry sc-inline tokens from an outer
      // styled(Component) descriptor; this native node resolves them.
      if (domProps.className.indexOf('sc-inline-') !== -1) {
        return { type: type.component, props: consumeInlineStyles(domProps) }
      }
      return { type: type.component, props: domProps }
    }
    // Component ref: inline styles cannot be attached here because the ref
    // decides which native node renders. Park them in the registry and ride
    // the className down to that node. All user props are forwarded to the
    // component (styled-components semantics), including `style` untouched;
    // the vars travel only through the registry.
    // Descriptors without pending vars skip the registry entirely; the
    // plain static className is all the native node needs.
    const styles = type.getInlineStyles(props || {})
    let forwarded = type.className
    for (const key in styles) {
      forwarded += ' sc-inline-' + registerInlineStyles(styles)
      break
    }
    const next = Object.assign({}, props)
    next.className =
      props && props.className ? forwarded + ' ' + props.className : forwarded
    return { type: type.component, props: next }
  }
  if (
    typeof type === 'string' &&
    props &&
    typeof props.className === 'string' &&
    props.className.indexOf('sc-inline-') !== -1
  ) {
    return { type, props: consumeInlineStyles(props) }
  }
  return null
}

// Works for createElement (rest = children), jsx/jsxs (rest = [key]) and
// jsxDEV (rest = [key, isStaticChildren, source, self]) alike.
// Resolution loops because one pass can surface another descriptor: a
// descriptor's component ref may itself be a descriptor (styled(Base) where
// Base compiled too), which unwraps one layer per pass until a plain type
// with no pending sc-inline tokens remains.
function wrapFactory(original) {
  return function (type, props) {
    // Hot path. This wrapper runs for *every* element the app creates, so the
    // common case — a native tag or ordinary component, no descriptor and no
    // pending sc-inline tokens — must cost almost nothing. Two cheap reads
    // gate the slow path:
    //   - `type[IS_STYLED]`: set on descriptors (and, harmlessly, on real
    //     styled wrappers that hoisted it — those fall through resolve() as a
    //     no-op). A plain string tag or function component reads undefined.
    //   - `inlineRegistry.size`: non-zero only during the brief window a
    //     styled(Component) descriptor with vars has forwarded a token that a
    //     downstream native node still needs to consume.
    // When neither holds we skip resolve() and the per-element className scan
    // and forward the call untouched.
    if (inlineRegistry.size === 0 && !(type && type[IS_STYLED])) {
      return original.apply(this, arguments)
    }
    let resolved = null
    for (
      let next = resolve(type, props);
      next !== null;
      next = resolve(next.type, next.props)
    ) {
      resolved = next
    }
    if (resolved === null) return original.apply(this, arguments)
    const args = [resolved.type, resolved.props]
    for (let i = 2; i < arguments.length; i++) args.push(arguments[i])
    return original.apply(this, args)
  }
}

function patchTarget(target, key) {
  if (!target || typeof target[key] !== 'function') return
  const original = target[key]
  const wrapped = wrapFactory(original)
  try {
    target[key] = wrapped
  } catch (error) {
    return
  }
  // Frozen or accessor-backed exports silently keep their original value.
  if (target[key] !== wrapped) return
  patchedEntries.push([target, key, original])
}

function loadOptionalModule(name) {
  try {
    return require(name)
  } catch (error) {
    return null
  }
}

// Idempotent. Patches React.createElement plus the automatic-runtime entry
// points when their CJS exports are writable.
function installCreateElementPatch() {
  if (installed) return
  installed = true
  patchedEntries = []
  patchTarget(React, 'createElement')
  const jsxRuntime = loadOptionalModule('react/jsx-runtime')
  if (jsxRuntime) {
    patchTarget(jsxRuntime, 'jsx')
    patchTarget(jsxRuntime, 'jsxs')
  }
  const jsxDevRuntime = loadOptionalModule('react/jsx-dev-runtime')
  if (jsxDevRuntime) {
    patchTarget(jsxDevRuntime, 'jsxDEV')
  }
}

function uninstallCreateElementPatch() {
  if (!installed) return
  for (let i = 0; i < patchedEntries.length; i++) {
    const entry = patchedEntries[i]
    entry[0][entry[1]] = entry[2]
  }
  patchedEntries = null
  installed = false
}

// Test-only helper, following the __resetSheet convention: reports how many
// sc-inline entries are pending so tests can assert delete-on-read hygiene.
function __getInlineRegistrySize() {
  return inlineRegistry.size
}

module.exports = {
  installCreateElementPatch,
  uninstallCreateElementPatch,
  // Wrap an original createElement/jsx/jsxs/jsxDEV so it resolves descriptors.
  // Exported so the `just-styled/jsx-runtime` entry points can build wrapped
  // runtimes directly (the jsxImportSource path), which does not depend on
  // monkeypatching a shared, possibly-frozen module namespace.
  wrapJsx: wrapFactory,
  __getInlineRegistrySize,
}
