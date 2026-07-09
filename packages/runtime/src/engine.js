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

// Serialize a static component's rule (resolve parts -> stylis compile -> prefix).
function serializeStatic(componentId, parts) {
  return serialize(
    compile('.' + componentId + '{' + resolveParts(parts, EMPTY) + '}'),
    middleware([prefixer, stringify])
  )
}

// ---- idle precompilation of static rules ------------------------------------
// A static component (module values / fragments, no prop-dependent functions) is
// cheap to render but still needs a stylis compile the first time it renders. We
// move that compile OFF the render critical path: at definition (module-load)
// time each static descriptor is queued, and a single requestIdleCallback drains
// the queue during browser idle, caching each serialized rule string. First
// render then just inserts the cached string (a DOM write, no compile).
//
// DOM insertion stays lazy — the idle pass only precomputes strings, it does not
// touch the sheet — so we never inject CSS for a component that is defined but
// never rendered, and sheet order still follows first render (no idle-vs-render
// ordering race). If a component renders before idle reaches it, registerStatic
// compiles inline; the shared idle callback + the staticRegistered guard mean the
// two paths never double-compile, so no explicit per-item cancellation is needed.
// Degrades to today's inline path where requestIdleCallback is unavailable
// (SSR / jsdom / older Safari).
const precomputed = new Map() // componentId -> serialized css (awaiting first render)
const pendingStatic = [] // { componentId, parts } awaiting idle precompile
let idleArmed = false

const ric =
  typeof requestIdleCallback === 'function'
    ? requestIdleCallback
    : typeof window !== 'undefined' && typeof window.requestIdleCallback === 'function'
    ? window.requestIdleCallback.bind(window)
    : null

function drainIdle(deadline) {
  idleArmed = false
  while (
    pendingStatic.length &&
    (!deadline || deadline.didTimeout || deadline.timeRemaining() > 1)
  ) {
    const item = pendingStatic.pop()
    // Skip anything a render already registered (or that we already precomputed).
    if (!staticRegistered.has(item.componentId) && !precomputed.has(item.componentId)) {
      precomputed.set(item.componentId, serializeStatic(item.componentId, item.parts))
    }
  }
  if (pendingStatic.length) {
    idleArmed = true
    ric(drainIdle)
  }
}

// Queue a static, non-precompiled descriptor for idle precompilation. No-op
// without an idle API (the rule is then compiled inline on first render).
function queueStatic(componentId, parts) {
  if (!ric) return
  pendingStatic.push({ componentId, parts })
  if (!idleArmed) {
    idleArmed = true
    ric(drainIdle)
  }
}

// Register a static component's rule under its componentId, once per sheet
// lifetime. The dedup guard is a module-level Set (cleared with the sheet in
// __reset), NOT a per-descriptor flag: descriptors are module-level and outlive
// any __resetSheet, so a per-descriptor "already done" boolean would stay true
// after the sheet was cleared and permanently suppress re-registration, leaving
// the static/compile-time CSS missing from the DOM. Keying the guard to the
// sheet's own lifetime keeps the two in sync. The serialized rule is taken from
// the plugin's build-time precompiled css when present, else the idle precompute
// cache, else compiled inline here — and only ever computed once.
const staticRegistered = new Set()
function registerStatic(componentId, group, parts, precompiled) {
  if (staticRegistered.has(componentId)) return
  staticRegistered.add(componentId)
  let css
  if (precompiled != null) {
    css = precompiled
  } else {
    css = precomputed.get(componentId)
    if (css === undefined) css = serializeStatic(componentId, parts)
    else precomputed.delete(componentId) // now in the sheet; free the interim copy
  }
  sheet.registerRule(group, componentId, css)
}

// Definition-order group counter. Each styled component takes the next group at
// definition time (module load), so a component that extends another always has
// a higher group than its base — which is what makes the sheet's group ordering
// put base rules before extender rules. (Mirrors styled-components.)
let groupCounter = 0
function nextGroup() {
  return groupCounter++
}

// Generated class for a resolved CSS body, hashed PER COMPONENT (componentId +
// css) and cached on the descriptor. Per-component (not global) so a rule belongs
// to exactly one component/group — a shared global class couldn't sit in two
// groups at once, which is what broke cross-component cascade ordering. Two
// components with identical css get distinct classes/rules (each in its own
// group), matching styled-components; within a component, its instances/renders
// still dedup via the descriptor's own cache. The descriptor's cache is lazily
// cleared after a sheet reset via the generation counter.
let generation = 0
function classFor(descriptor, cssBody) {
  if (descriptor._gen !== generation) {
    descriptor._cache = new Map()
    descriptor._gen = generation
  }
  const cached = descriptor._cache.get(cssBody)
  if (cached !== undefined) return cached
  const cls = 'js-' + hash(descriptor.componentId + cssBody)
  descriptor._cache.set(cssBody, cls)
  sheet.registerRule(
    descriptor.group,
    cls,
    serialize(compile('.' + cls + '{' + cssBody + '}'), middleware([prefixer, stringify]))
  )
  return cls
}

function __reset() {
  generation++ // descriptor caches are lazily rebuilt on next use
  staticRegistered.clear()
}

module.exports = {
  cacheParts,
  resolveParts,
  classFor,
  isStatic,
  registerStatic,
  queueStatic,
  nextGroup,
  hash,
  __reset,
}
