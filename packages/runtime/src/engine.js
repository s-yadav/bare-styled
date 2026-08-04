// Render-time style engine (hash-class model): styled-components' approach —
// resolve interpolations against props, hash, inject the rule once — but run
// from the JSX runtime so the styled component collapses to a host element.
'use strict'

const { compile, serialize, stringify, middleware, prefixer, rulesheet } = require('stylis')
const sheet = require('./sheet')

const EMPTY = {}

// Vendor prefixing is OPT-IN (styled-components v6 parity). Pair with the
// plugin's `vendorPrefixes: true` so build-time compiled rules match.
let vendorPrefixes = false
function setVendorPrefixes(on) {
  vendorPrefixes = !!on
}

// Compile css into an ARRAY of individual rules via stylis's rulesheet
// middleware (re-splitting a serialized blob breaks on braces inside quoted
// strings like content:"}"; CSSOM insertRule needs one rule at a time).
function compileRules(css) {
  const rules = []
  const collect = rulesheet(function (rule) {
    rules.push(rule)
  })
  serialize(
    compile(css),
    middleware(vendorPrefixes ? [prefixer, stringify, collect] : [stringify, collect])
  )
  return rules
}

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

// Flatten the tagged template once at definition time (styled-components'
// css() bakes static parts into strings; functions survive for render).
// GOTCHA: css() can THROW when interpolated objects come from a DIFFERENT
// styled-components copy (instanceof Keyframes misses → toString throws).
// A template must never crash module eval — fall back to a naive interleave;
// resolveValue handles every chunk type, incl. foreign keyframes (duck-typed).
function cacheParts(strings, interps) {
  if (scCss) {
    try {
      return scCss(strings, ...interps)
    } catch (e) {
      /* fall through to the naive interleave */
    }
  }
  if (interps.length === 0) return [strings.join('')]
  const parts = []
  for (let i = 0; i < strings.length; i++) {
    if (strings[i]) parts.push(strings[i])
    if (i < interps.length) parts.push(interps[i])
  }
  return parts
}

// ---- keyframes ---------------------------------------------------------------
// styled-components Keyframes are duck-typed ({ name, rules, getName } — same
// shape in v5/v6, instanceof-free so duplicate SC copies work). Inject the
// @keyframes rule into OUR sheet once, resolve to the animation name. Name-
// scoped and order-independent, so all share one lazily-created group.
let keyframesGroup = -1
const compiledKeyframes = new Map() // name -> compiled rules array
function isKeyframes(v) {
  return (
    typeof v.getName === 'function' &&
    typeof v.name === 'string' &&
    (typeof v.rules === 'string' || Array.isArray(v.rules))
  )
}
function registerKeyframes(v) {
  let rules = compiledKeyframes.get(v.name)
  if (rules === undefined) {
    const body = typeof v.rules === 'string' ? v.rules : v.rules.join('')
    rules = compileRules('@keyframes ' + v.name + '{' + body + '}')
    compiledKeyframes.set(v.name, rules)
  }
  if (keyframesGroup < 0) keyframesGroup = nextGroup()
  sheet.registerRule(keyframesGroup, 'kf-' + v.name, rules)
  return v.name
}

// Resolve one flattened value against props (execution context). Functions are
// called (and their result re-resolved), arrays/fragments are joined, keyframes
// are injected into our sheet and resolve to their animation name. Other
// objects are stringified defensively (swallowing any toString throw).
function resolveValue(v, props) {
  if (v === null || v === undefined || v === false || v === '') return ''
  const t = typeof v
  if (t === 'string') return v
  if (t === 'number') return String(v)
  if (t === 'function') {
    // KNOWN LIMITATION: no ThemeProvider — `props.theme` is undefined, so
    // `p => p.theme.x` throws. Swallow it and drop that interpolation (the
    // rest of the rule still applies). Use module-scope theme constants.
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
  if (isKeyframes(v)) return registerKeyframes(v)
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

// Static = no surviving function interpolations (css() already baked
// everything else into strings). Static components register one rule under
// their componentId — no per-render resolve or hash.
function isStatic(parts) {
  for (let i = 0; i < parts.length; i++) if (typeof parts[i] === 'function') return false
  return true
}

// Compile a static component's rule (resolve parts -> stylis) to a rules array.
function serializeStatic(componentId, parts) {
  return compileRules('.' + componentId + '{' + resolveParts(parts, EMPTY) + '}')
}

// ---- idle precompilation of static rules ------------------------------------
// Static rules the build couldn't prove compile during requestIdleCallback, off
// the render critical path; first render just inserts the cached string. The
// idle pass ONLY precomputes — DOM insertion stays lazy (no CSS for unrendered
// components, no idle-vs-render ordering race). Falls back to inline compile
// where rIC is unavailable (SSR / jsdom / older Safari).
const precomputed = new Map() // componentId -> compiled rules array (awaiting first render)
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
// lifetime. Guards must be keyed to the SHEET lifetime (generation / a Set
// cleared in __reset), never a plain per-descriptor boolean — descriptors
// outlive __resetSheet and would permanently suppress re-registration.
// Rule source: build-precompiled css > idle precompute cache > inline compile.
const staticRegistered = new Set()
function registerStatic(descriptor) {
  // Runs on EVERY render of every static element: the generation stamp is a
  // single property compare on the hot path.
  if (descriptor._regGen === generation) return
  descriptor._regGen = generation
  const componentId = descriptor.componentId
  if (staticRegistered.has(componentId)) return
  staticRegistered.add(componentId)
  let css
  if (descriptor.css != null) {
    css = descriptor.css // plugin's build-time precompiled rule string
  } else {
    css = precomputed.get(componentId)
    if (css === undefined) css = serializeStatic(componentId, descriptor.parts)
    else precomputed.delete(componentId) // now in the sheet; free the interim copy
  }
  sheet.registerRule(descriptor.group, componentId, css)
}

// Definition-order group counter: a base is always defined before its extender,
// so base.group < extender.group — the sheet's group ordering makes extenders
// win equal-specificity conflicts. (Mirrors styled-components.)
let groupCounter = 0
function nextGroup() {
  return groupCounter++
}

// "Flat" = plain declarations, no { } & @ / — stylis would serialize it
// verbatim into one rule. `/` is rejected because stylis strips // comments,
// which a raw rule can't contain; legit slashes (font:16px/1.5, url()) just
// take the stylis path. Conservative but always correct.
function isFlatBody(css) {
  for (let i = 0; i < css.length; i++) {
    const c = css.charCodeAt(i)
    if (c === 123 || c === 125 || c === 38 || c === 64 || c === 47) return false // { } & @ /
  }
  return true
}

// Class for a resolved CSS body, hashed PER COMPONENT and cached on the
// descriptor. Per-component (never global): a rule must belong to exactly one
// group or cross-component cascade ordering breaks. Caches lazily reset after
// __reset via the generation counter.
let generation = 0
function classFor(descriptor, cssBody) {
  if (descriptor._gen !== generation) {
    descriptor._cache = new Map()
    descriptor._gen = generation
  }
  const cached = descriptor._cache.get(cssBody)
  if (cached !== undefined) return cached
  const cls = 'bs-' + hash(descriptor.componentId + cssBody)
  descriptor._cache.set(cssBody, cls)
  // Flat bodies skip stylis: `.cls{body}` IS the finished rule (prefixing off).
  const rules =
    !vendorPrefixes && isFlatBody(cssBody)
      ? ['.' + cls + '{' + cssBody + '}']
      : compileRules('.' + cls + '{' + cssBody + '}')
  sheet.registerRule(descriptor.group, cls, rules)
  return cls
}

// ---- skeleton mode -------------------------------------------------------------
// The build ships `skeleton` (stylis-compiled rule, `__bsc__` class token +
// `var(--bs-N)` value placeholders) and `vars` (live expressions, in slot
// order). Render never runs stylis: resolve the fns, cache by the short joined
// value string, stitch misses from segments parsed once at definition.
const SKELETON_TOKEN_RE = /__bsc__|var\(--bs-(\d+)\)/g
function parseSkeleton(skeleton) {
  const strings = []
  const slots = []
  let last = 0
  let m
  SKELETON_TOKEN_RE.lastIndex = 0
  while ((m = SKELETON_TOKEN_RE.exec(skeleton))) {
    strings.push(skeleton.slice(last, m.index))
    slots.push(m[1] === undefined ? -1 : +m[1])
    last = m.index + m[0].length
  }
  strings.push(skeleton.slice(last))
  return { strings, slots }
}

// Substitute non-function vars into a skeleton once (definition time). The
// remaining var indices are renumbered against the fns array order.
function substituteStaticVars(skeleton, vars) {
  const fns = []
  const resolved = vars.map(v => (typeof v === 'function' ? null : resolveValue(v, EMPTY)))
  const out = skeleton.replace(SKELETON_TOKEN_RE, m0 => {
    if (m0 === '__bsc__') return '__bsc__'
    const k = +m0.slice(9, -1) // var(--bs-K)
    if (resolved[k] !== null) return resolved[k]
    let idx = fns.indexOf(vars[k])
    if (idx === -1) {
      idx = fns.length
      fns.push(vars[k])
    }
    return 'var(--bs-' + idx + ')'
  })
  return { skeleton: out, fns }
}

// Class + rule for a skeleton component's resolved var values. The cache key is
// the SHORT joined value string (not a full CSS body); the miss path is a
// segment join — no stylis. Values containing braces could break out of the
// precompiled structure, so those variants are renormalized through stylis
// (rare; typically hostile or malformed input).
function classForVars(descriptor, values) {
  if (descriptor._gen !== generation) {
    descriptor._cache = new Map()
    descriptor._gen = generation
  }
  let key = values[0]
  for (let i = 1; i < values.length; i++) key += '\x1f' + values[i]
  const cached = descriptor._cache.get(key)
  if (cached !== undefined) return cached
  const cls = 'bs-' + hash(descriptor.componentId + '\x1f' + key)
  descriptor._cache.set(key, cls)

  const seg = descriptor._segments
  let css = seg.strings[0]
  let braces = false
  for (let i = 0; i < seg.slots.length; i++) {
    const s = seg.slots[i]
    if (s === -1) css += cls
    else {
      const v = values[s]
      if (v.indexOf('{') !== -1 || v.indexOf('}') !== -1) braces = true
      css += v
    }
    css += seg.strings[i + 1]
  }
  sheet.registerRule(descriptor.group, cls, braces ? compileRules(css) : css)
  return cls
}

function __reset() {
  generation++ // descriptor caches are lazily rebuilt on next use
  staticRegistered.clear()
}

module.exports = {
  cacheParts,
  resolveParts,
  resolveValue,
  classFor,
  classForVars,
  parseSkeleton,
  substituteStaticVars,
  isStatic,
  registerStatic,
  queueStatic,
  nextGroup,
  hash,
  setVendorPrefixes,
  __reset,
}
