// Public runtime entry point (`just-styled/runtime`).
// CommonJS on purpose: this package ships source, and consumers (jest,
// bundlers, node) all load it without a transform step.
'use strict'

const React = require('react')
const sheet = require('./sheet')
const patchImpl = require('./patch-impl')
const engine = require('./engine')

// Shared global symbol so the patch/jsx runtime recognizes descriptors even
// across duplicate runtime copies.
const IS_STYLED = Symbol.for('just-styled')

// The plugin emits `createStyled(component, { componentId, displayName })`tpl``.
// The tagged template's interpolations stay live; styled-components' css()
// flattens the static half once here, and the engine resolves the rest per
// render into a hash-class (styled-components' model) — but the descriptor is
// resolved to a host element by the JSX runtime, so there is no wrapper fiber.
function createStyled(component, config) {
  const componentId = config.componentId
  const displayName = config.displayName
  const precompiled = config.css // Opt 2: build-time compiled rule for a zero-interpolation template
  return function (strings) {
    const interps = Array.prototype.slice.call(arguments, 1)
    // A precompiled rule is static by definition; otherwise flatten the static
    // half once and decide static-vs-dynamic from whether any function survives.
    const parts = precompiled != null ? null : engine.cacheParts(strings, interps)
    const isStatic = precompiled != null || engine.isStatic(parts)

    // forwardRef so the descriptor is a valid element type and still renders
    // correctly if neither the patch nor the jsx runtime is installed.
    const element = React.forwardRef(function JustStyled(props, ref) {
      const r = patchImpl.resolveDescriptor(element, props)
      return React.createElement(r.type, ref == null ? r.props : Object.assign({}, r.props, { ref }))
    })

    element[IS_STYLED] = element // hoisting-proof self-reference discriminator
    element.component = component
    element.componentId = componentId
    element.styledComponentId = componentId // component-selector target
    element.parts = parts
    element.css = precompiled
    element.isStatic = isStatic
    element._staticDone = false
    element.target = component
    if (displayName) element.displayName = displayName
    element.toString = function () {
      return '.' + componentId
    }
    return element
  }
}

module.exports = {
  IS_STYLED,
  createStyled,
  // Root createElement for the automatic runtime's key-after-spread fallback
  // (imported from the import-source root), wrapped to resolve descriptors.
  createElement: patchImpl.wrapJsx(React.createElement),
  Fragment: React.Fragment,
  getCss: sheet.getCss,
  renderStaticStyles: sheet.renderStaticStyles,
  __resetSheet: function () {
    sheet.__resetSheet()
    engine.__reset()
  },
  installCreateElementPatch: patchImpl.installCreateElementPatch,
  uninstallCreateElementPatch: patchImpl.uninstallCreateElementPatch,
}
