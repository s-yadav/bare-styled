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
// identity check excludes it.
function isDescriptor(type) {
  return Boolean(type && type[IS_STYLED] === type)
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
    // hash class carries the resolved styles.
    styleClass = ' ' + engine.classFor(type.componentId, engine.resolveParts(type.parts, p))
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

function resolve(type, props) {
  return isDescriptor(type) ? resolveDescriptor(type, props) : null
}

// Wrap createElement/jsx/jsxs/jsxDEV. Hot path: non-descriptors forward
// untouched after a single symbol read. Resolution loops so a descriptor whose
// target is itself a descriptor unwraps to a plain type.
function wrapFactory(original) {
  return function (type, props) {
    if (!(type && type[IS_STYLED])) return original.apply(this, arguments)
    let resolved = null
    for (let next = resolve(type, props); next !== null; next = resolve(next.type, next.props)) {
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

module.exports = {
  installCreateElementPatch,
  uninstallCreateElementPatch,
  wrapJsx: wrapFactory,
  resolveDescriptor,
}
