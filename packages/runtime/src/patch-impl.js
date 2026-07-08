// createElement / jsx patch + descriptor resolution (hash-class model).
//
// A descriptor produced by `createStyled` is resolved to a plain host element
// (or forwarded to its component target) at element-creation time — no wrapper
// fiber. Styles are generated exactly like styled-components (resolve the
// template against props, hash, inject a rule, use the class), just without the
// component in the tree. No CSS variables, no bail-out, no sc-inline.
'use strict'

const React = require('react')
const isPropValid = require('@emotion/is-prop-valid').default
const engine = require('./engine')

const IS_STYLED = Symbol.for('just-styled')
const EMPTY = {}

let installed = false
let patchedEntries = null

// A genuine descriptor self-references under the shared symbol; a real styled
// component that hoisted the symbol points at the original descriptor, so the
// identity check excludes it. The `typeof === 'object'` gate is a hot-path
// optimization: this runs for EVERY element the app creates, and it lets string
// tags ('div') and function components skip the symbol property read entirely
// (descriptors are forwardRef objects).
function isDescriptor(type) {
  return type !== null && typeof type === 'object' && type[IS_STYLED] === type
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

// Filter props for a native tag (drop non-DOM props styled-components style),
// set the resolved className, and drop the `as` control prop.
function buildHostProps(props, className) {
  const next = {}
  if (props) {
    for (const key in props) {
      if (key === 'as') continue
      if (isAlwaysKept(key) || isPropValid(key)) next[key] = props[key]
    }
  }
  next.className = className
  return next
}

// Resolve a descriptor + props into { type, props } for the real element.
// Exported so createStyled's forwardRef body can render even without the patch.
function resolveDescriptor(type, props) {
  const p = props || EMPTY
  let styleClass = ''
  if (type.isStatic) {
    // Styles never change: resolve+inject once under the componentId, which
    // then doubles as the style class. No per-render resolve or hash.
    if (!type._staticDone) {
      engine.registerStatic(
        type.componentId,
        type.css != null ? null : engine.resolveParts(type.parts, EMPTY),
        type.css // build-time precompiled rule (Opt 2), if the plugin supplied one
      )
      type._staticDone = true
    }
  } else {
    // Prop-dependent: componentId is a marker (for `${Comp}` selectors); the
    // hash class carries the resolved styles. classFor caches globally by the
    // resolved css, so identical styles hash + inject once across all components.
    styleClass = ' ' + engine.classFor(engine.resolveParts(type.parts, p))
  }
  const className = type.componentId + styleClass + (p.className ? ' ' + p.className : '')
  const target = p.as || type.component
  if (typeof target === 'string') {
    return { type: target, props: buildHostProps(p, className) }
  }
  // Component target: forward all props (minus `as`) + the className, which the
  // component is expected to spread onto its host node.
  const next = Object.assign({}, p)
  delete next.as
  next.className = className
  return { type: target, props: next }
}

// Resolve a descriptor (and unwrap a descriptor-wrapping-descriptor chain) to
// the final { type, props }. Callers first check isDescriptor, so `type` here
// is always a descriptor.
function unwrap(type, props) {
  let r = resolveDescriptor(type, props)
  while (isDescriptor(r.type)) r = resolveDescriptor(r.type, r.props)
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
}
