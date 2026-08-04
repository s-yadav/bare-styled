// createElement / jsx patch + descriptor resolution: descriptors resolve to
// plain host elements at element-creation time — no wrapper fiber.
'use strict'

const React = require('react')
const isPropValid = require('@emotion/is-prop-valid').default
const engine = require('./engine')

const IS_STYLED = Symbol.for('bare-styled')
const EMPTY = {}

let installed = false
let patchedEntries = null

// Self-reference under the shared symbol (a hoisted copy would point at the
// original, not itself). Runs for EVERY element the app creates: the typeof
// gate lets string tags and function components skip the symbol read.
function isDescriptor(type) {
  return type !== null && typeof type === 'object' && type[IS_STYLED] === type
}

// Apply a base-first attrs list, styled-components semantics: attrs OVERRIDE
// the context (the fn received the props), except className (joined) and
// style (shallow-merged). Throwing attr fns are dropped (theme limitation).
function applyAttrs(attrsList, props) {
  const context = {}
  for (const key in props) context[key] = props[key]
  for (let i = 0; i < attrsList.length; i++) {
    const attrDef = attrsList[i]
    let resolved
    if (typeof attrDef === 'function') {
      try {
        resolved = attrDef(context)
      } catch (e) {
        resolved = null
      }
    } else {
      resolved = attrDef
    }
    if (!resolved) continue
    for (const key in resolved) {
      const v = resolved[key]
      if (key === 'className') {
        context.className = context.className ? context.className + ' ' + v : v
      } else if (key === 'style') {
        context.style = Object.assign({}, context.style, v)
      } else {
        context[key] = v
      }
    }
  }
  return context
}

// Props kept on a native tag regardless of @emotion/is-prop-valid.
function isAlwaysKept(key) {
  return (
    key === 'className' ||
    key === 'style' ||
    key === 'children' ||
    key === 'key' ||
    key === 'ref' ||
    (key.charCodeAt(0) === 111 && key.charCodeAt(1) === 110) || // on* event handlers
    key.indexOf('data-') === 0 ||
    key.indexOf('aria-') === 0
  )
}

// Filter props for a native tag. A custom shouldForwardProp REPLACES the
// default filter (styled-components semantics); className/style/children stay
// managed; `as` is dropped.
function buildHostProps(props, className, sfp, target) {
  const next = {}
  if (props) {
    // sfp hoisted out of the loop: the default-filter loop is the hot path
    // (runs per prop of every styled host element).
    if (sfp) {
      for (const key in props) {
        if (key === 'as') continue
        if (key === 'className' || key === 'style' || key === 'children' || sfp(key, target)) {
          next[key] = props[key]
        }
      }
    } else {
      for (const key in props) {
        if (key === 'as') continue
        if (isAlwaysKept(key) || isPropValid(key)) next[key] = props[key]
      }
    }
  }
  next.className = className
  return next
}

// The descriptor's style classes for these props. Also the styled-components
// fold interop entry point (the descriptor's componentStyle shim).
function styleClassesFor(type, props) {
  if (type.isStatic) {
    // Rule injected once under the componentId, which doubles as the class.
    engine.registerStatic(type)
    return type.componentId
  }
  if (type._varFns) {
    // Skeleton mode: resolve the value fns; engine stitches/caches by the
    // short joined value key — no stylis, no full-body string.
    const fns = type._varFns
    const values = new Array(fns.length)
    for (let i = 0; i < fns.length; i++) values[i] = engine.resolveValue(fns[i], props)
    return type.componentId + ' ' + engine.classForVars(type, values)
  }
  // Live template: componentId is the `${Comp}` selector marker; the hash
  // class carries the resolved styles.
  return (
    type.componentId + ' ' + engine.classFor(type, engine.resolveParts(type.parts, props))
  )
}

// Resolve a descriptor + props into { type, props } for the real element.
// `sfp` (shouldForwardProp) and `fwd` (forwardProps) are the chain-effective
// values threaded from the outermost descriptor — extender's config wins,
// styled-components' folding semantics. Attrs are NOT applied here — unwrap
// applies the chain's full base-first attrs list exactly once before
// resolution starts.
//
// forwardProps: ONE call shaping ALL element props — `(props) => nextProps`.
// What it returns is what the final target receives (plus our className and a
// preserved `children` unless the shape explicitly includes one). It fully
// replaces the default per-prop filter AND shouldForwardProp — a single
// destructure instead of a closure call per prop. Style interpolations
// resolved above see the ORIGINAL context, so transient styling props can be
// stripped from the element while still driving CSS. It applies only at the
// FINAL target (host tag or non-descriptor component); intermediate descriptor
// levels keep the full context so every template in the chain sees all props.
//
// Cascade ordering (styled(StyledComponent), same element, etc.) is handled by
// the sheet's group ordering — each component's rule lands in its definition-order
// group, so a base always precedes its extender. Nothing to reorder here.
function resolveDescriptor(type, props, sfp, fwd) {
  const p = props || EMPTY
  const styleClasses = styleClassesFor(type, p)
  const target = p.as || type.component

  // isFinal (host tag or non-descriptor component) is only needed on the fwd
  // path — keep it off the common per-element path.
  if (fwd && (typeof target === 'string' || !isDescriptor(target))) {
    const shaped = fwd(p) || EMPTY
    const next = {}
    for (const key in shaped) {
      // `as` was already consumed for target selection; className merges below;
      // children always come from the ORIGINAL element (forwardProps shapes
      // attributes — and the classic createElement path re-appends positional
      // children anyway, so honoring a shaped children key would behave
      // differently between the jsx runtime and the patch).
      if (key !== 'as' && key !== 'className' && key !== 'children') next[key] = shaped[key]
    }
    if ('children' in p) next.children = p.children
    next.className = styleClasses + (shaped.className ? ' ' + shaped.className : '')
    return { type: target, props: next }
  }

  const className = styleClasses + (p.className ? ' ' + p.className : '')
  if (typeof target === 'string') {
    return { type: target, props: buildHostProps(p, className, sfp, target) }
  }
  // Component target: forward all props (minus `as`) + the className, which the
  // component is expected to spread onto its host node. Copy-skip loop instead
  // of Object.assign + delete: this runs per render of every styled(Component)
  // element, and `delete` transitions the object to dictionary mode.
  const next = {}
  for (const key in p) {
    if (key !== 'as') next[key] = p[key]
  }
  next.className = className
  return { type: target, props: next }
}

// Resolve a descriptor (and unwrap a descriptor-wrapping-descriptor chain) to
// the final { type, props }. Callers first check isDescriptor, so `type` here
// is always a descriptor. The chain's attrs (precomputed base-first at
// definition as `_attrsAll`) are applied ONCE up front — base attrs first,
// extender's later so the extender overrides, matching styled-components'
// folded ordering — and the merged context feeds both style resolution and the
// final element props.
function unwrap(type, props) {
  const p = type._attrsAll ? applyAttrs(type._attrsAll, props || EMPTY) : props
  const sfp = type._sfp
  const fwd = type._fwd
  let r = resolveDescriptor(type, p, sfp, fwd)
  while (isDescriptor(r.type)) r = resolveDescriptor(r.type, r.props, sfp, fwd)
  return r
}

// The automatic runtime's jsx/jsxs: fixed arity (type, props, key). Forward
// directly — no `arguments` object, no `.apply` — so the app-wide hot path
// (every non-styled element) is a single isDescriptor check + a direct call.
function wrapJsx(original) {
  return function (type, props, key) {
    if (!isDescriptor(type)) return original(type, props, key)
    const r = unwrap(type, props)
    return original(r.type, r.props, key)
  }
}

// jsxDEV carries extra dev args (isStaticChildren, source, self) — forward them.
function wrapJsxDev(original) {
  return function (type, props, key, isStaticChildren, source, self) {
    if (!isDescriptor(type)) return original(type, props, key, isStaticChildren, source, self)
    const r = unwrap(type, props)
    return original(r.type, r.props, key, isStaticChildren, source, self)
  }
}

// classic createElement is variadic (children as rest args), so it keeps the
// arguments-based forward.
function wrapCreateElement(original) {
  return function (type, props) {
    if (!isDescriptor(type)) return original.apply(this, arguments)
    const r = unwrap(type, props)
    const args = [r.type, r.props]
    for (let i = 2; i < arguments.length; i++) args.push(arguments[i])
    return original.apply(this, args)
  }
}

function patchTarget(target, key, factory) {
  if (!target || typeof target[key] !== 'function') return
  const original = target[key]
  const wrapped = factory(original)
  try {
    target[key] = wrapped
  } catch (e) {
    return
  }
  if (target[key] !== wrapped) return
  patchedEntries.push([target, key, original])
}

function loadOptionalModule(name) {
  try {
    return require(name)
  } catch (e) {
    return null
  }
}

function installCreateElementPatch() {
  if (installed) return
  installed = true
  patchedEntries = []
  patchTarget(React, 'createElement', wrapCreateElement)
  const jsxRuntime = loadOptionalModule('react/jsx-runtime')
  if (jsxRuntime) {
    patchTarget(jsxRuntime, 'jsx', wrapJsx)
    patchTarget(jsxRuntime, 'jsxs', wrapJsx)
  }
  const jsxDevRuntime = loadOptionalModule('react/jsx-dev-runtime')
  if (jsxDevRuntime) {
    patchTarget(jsxDevRuntime, 'jsxDEV', wrapJsxDev)
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

module.exports = {
  installCreateElementPatch,
  uninstallCreateElementPatch,
  wrapJsx, // jsx / jsxs (type, props, key)
  wrapJsxDev, // jsxDEV
  wrapCreateElement, // classic createElement (variadic)
  resolveDescriptor,
  unwrap, // full chain resolution incl. attrs (used by the forwardRef fallback)
  applyAttrs,
  styleClassesFor, // styled-components fold interop (componentStyle shim)
}
