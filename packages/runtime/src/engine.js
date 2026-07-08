// Render-time style engine (hash-class model).
//
// This is styled-components' own approach — resolve the template's
// interpolations against the current props, hash the resulting CSS, generate a
// class name, and inject the rule once — but run from the JSX runtime so the
// styled component collapses to a host element (no wrapper fiber) instead of a
// React component. No CSS variables, no bail-out, no sc-inline forwarding.
//
// styled-components' `css()` does the static half of the flatten for us at
// definition time (resolving module values, inlining `css` fragments,
// serializing style objects, turning `${StyledComponent}` into `.selector`),
// leaving only prop-dependent functions. We call those functions per render.
'use strict'

const { compile, serialize, stringify, middleware, prefixer } = require('stylis')
const sheet = require('./sheet')

const EMPTY = {}

let scCss = null
try {
  scCss = require('styled-components').css
} catch (e) {
  scCss = null
}

// MurmurHash2 (same family styled-components uses) -> base36.
function hash(str) {
  let l = str.length
  let h = l
  let i = 0
  let k
  while (l >= 4) {
    k =
      (str.charCodeAt(i) & 0xff) |
      ((str.charCodeAt(++i) & 0xff) << 8) |
      ((str.charCodeAt(++i) & 0xff) << 16) |
      ((str.charCodeAt(++i) & 0xff) << 24)
    k = (k & 0xffff) * 0x5bd1e995 + ((((k >>> 16) * 0x5bd1e995) & 0xffff) << 16)
    k ^= k >>> 24
    k = (k & 0xffff) * 0x5bd1e995 + ((((k >>> 16) * 0x5bd1e995) & 0xffff) << 16)
    h = ((h & 0xffff) * 0x5bd1e995 + ((((h >>> 16) * 0x5bd1e995) & 0xffff) << 16)) ^ k
    l -= 4
    ++i
  }
  /* eslint-disable no-fallthrough */
  switch (l) {
    case 3:
      h ^= (str.charCodeAt(i + 2) & 0xff) << 16
    case 2:
      h ^= (str.charCodeAt(i + 1) & 0xff) << 8
    case 1:
      h ^= str.charCodeAt(i) & 0xff
      h = (h & 0xffff) * 0x5bd1e995 + ((((h >>> 16) * 0x5bd1e995) & 0xffff) << 16)
  }
  /* eslint-enable no-fallthrough */
  h ^= h >>> 13
  h = (h & 0xffff) * 0x5bd1e995 + ((((h >>> 16) * 0x5bd1e995) & 0xffff) << 16)
  h ^= h >>> 15
  return (h >>> 0).toString(36)
}

// Flatten the tagged template once at definition time. Module values, css
// fragments, styled-component selectors and style objects are baked into
// strings here; user functions survive to be called per render.
function cacheParts(strings, interps) {
  if (scCss) return scCss(strings, ...interps)
  // Without styled-components we can only handle a plain (non-interpolated) template.
  return [strings.join('')]
}

// Resolve one flattened value against props (execution context). Functions are
// called (and their result re-resolved), arrays/fragments are joined. Objects
// that aren't styled components are stringified defensively (keyframes' toString
// throws until injected — swallow that; keyframes support comes later).
function resolveValue(v, props) {
  if (v === null || v === undefined || v === false || v === '') return ''
  const t = typeof v
  if (t === 'string') return v
  if (t === 'number') return String(v)
  if (t === 'function') {
    // KNOWN LIMITATION: theme via <ThemeProvider> is not supported — a plain
    // host element can't read React context, so `props.theme` is undefined and
    // `p => p.theme.x` throws. We swallow the throw and drop that interpolation
    // (the rest of the rule still applies) rather than crash the render. Use a
    // module-scope theme constant instead. See README / docs.
    try {
      return resolveValue(v(props), props)
    } catch (e) {
      return ''
    }
  }
  if (Array.isArray(v)) {
    let out = ''
    for (let i = 0; i < v.length; i++) out += resolveValue(v[i], props)
    return out
  }
  if (v.styledComponentId) return '.' + v.styledComponentId
  try {
    return typeof v.toString === 'function' ? v.toString() : ''
  } catch (e) {
    return ''
  }
}

// Build the resolved CSS body for these cached parts + props.
function resolveParts(parts, props) {
  let out = ''
  for (let i = 0; i < parts.length; i++) out += resolveValue(parts[i], props)
  return out
}

// A component is static when no interpolation is prop-dependent (css() already
// baked module values, fragments and selectors into strings, so any surviving
// function is the only thing that can vary between renders). Static components
// resolve once to a single rule under their componentId — no per-render resolve
// or hash.
function isStatic(parts) {
  for (let i = 0; i < parts.length; i++) if (typeof parts[i] === 'function') return false
  return true
}

// Register a static component's rule under its componentId, once per sheet
// lifetime. The dedup guard is a module-level Set (cleared with the sheet in
// __reset), NOT a per-descriptor flag: descriptors are module-level and outlive
// any __resetSheet, so a per-descriptor "already done" boolean would stay true
// after the sheet was cleared and permanently suppress re-registration, leaving
// the static/compile-time CSS missing from the DOM. Keying the guard to the
// sheet's own lifetime keeps the two in sync. The resolved css body is computed
// (or the plugin's precompiled rule used) only on the first miss.
const staticRegistered = new Set()
function registerStatic(componentId, parts, precompiled) {
  if (staticRegistered.has(componentId)) return
  staticRegistered.add(componentId)
  sheet.registerRule(
    componentId,
    precompiled != null
      ? precompiled
      : serialize(
          compile('.' + componentId + '{' + resolveParts(parts, EMPTY) + '}'),
          middleware([prefixer, stringify])
        )
  )
}

// Generated class for a resolved CSS body, keyed by the resolved string in a
// single GLOBAL cache. A repeated/unchanged style — whether the same component
// re-rendering or a *different* component resolving to identical styles — is one
// Map lookup with no key allocation; the MurmurHash + stylis compile + injection
// run only the first time a given resolved style is seen anywhere. Global (not
// per-descriptor) because styled components are module-level and never GC'd, so
// per-descriptor caches free nothing and would re-hash the same css per
// component. The class is hashed from the css alone (componentId is carried
// separately as a marker class for `${Comp}` selectors — see resolveDescriptor),
// so identical styles across components share one class and one rule.
const classCache = new Map()
function classFor(cssBody) {
  const cached = classCache.get(cssBody)
  if (cached !== undefined) return cached
  const cls = 'js-' + hash(cssBody)
  classCache.set(cssBody, cls)
  sheet.registerRule(
    cls,
    serialize(compile('.' + cls + '{' + cssBody + '}'), middleware([prefixer, stringify]))
  )
  return cls
}

function __reset() {
  classCache.clear()
  staticRegistered.clear()
}

module.exports = { cacheParts, resolveParts, classFor, isStatic, registerStatic, hash, __reset }
