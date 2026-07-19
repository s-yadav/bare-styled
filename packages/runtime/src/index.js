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

// Count of descriptor renders that went through the forwardRef fallback (i.e.
// paid a wrapper fiber instead of being resolved at element creation). Should
// stay 0 in a correctly wired app; see the warning inside createStyled.
let fallbackRenders = 0

// The plugin emits `createStyled(component, { componentId, displayName })`tpl``.
// The tagged template's interpolations stay live; styled-components' css()
// flattens the static half once here, and the engine resolves the rest per
// render into a hash-class (styled-components' model) — but the descriptor is
// resolved to a host element by the JSX runtime, so there is no wrapper fiber.
//
// styled(StyledComponent) is NOT folded: base and extender keep their own rules
// (so each component's styles stay traceable to it in DevTools, like
// styled-components). The extender wins the cascade through the sheet's group
// ordering — groups are assigned in definition order (engine.nextGroup below),
// and a base is always defined before its extender, so base rules precede
// extender rules in the sheet regardless of render order.
function createStyled(component, config) {
  const componentId = config.componentId
  const displayName = config.displayName
  const precompiled = config.css // build-time stylis-serialized rule for a fully-static template
  return function (strings) {
    const interps = Array.prototype.slice.call(arguments, 1)
    // A precompiled rule is static by definition; otherwise flatten the static
    // half once and decide static-vs-dynamic from whether any function survives.
    const parts = precompiled != null ? null : engine.cacheParts(strings, interps)
    const isStatic = precompiled != null || engine.isStatic(parts)

    // A non-precompiled static component still has a stylis compile to do on first
    // render — queue it for idle precompilation so that work happens off the
    // render critical path (see engine.queueStatic).
    if (isStatic && precompiled == null) engine.queueStatic(componentId, parts)

    // forwardRef so the descriptor is a valid element type and still renders
    // correctly if it reaches React WITHOUT being intercepted at element
    // creation. That should be rare: it means a wrapper fiber exists, which is
    // exactly what just-styled removes. Known ways to get here:
    //   - a file compiled without jsxImportSource 'just-styled' AND the
    //     createElement patch failed to install (frozen ESM namespace);
    //   - memo(StyledX) / lazy(...) — React unwraps those to the descriptor
    //     internally, never re-entering element creation;
    //   - a third-party lib creating elements via its own unpatched runtime.
    // In dev this warns once per component so misses are visible instead of
    // silently costing a fiber; __getFallbackRenders() counts every hit.
    const element = React.forwardRef(function JustStyled(props, ref) {
      fallbackRenders++
      if (
        typeof process !== 'undefined' &&
        process.env.NODE_ENV !== 'production' &&
        !element._warnedFallback
      ) {
        element._warnedFallback = true
        // eslint-disable-next-line no-console
        console.warn(
          '[just-styled] <' +
            (element.displayName || componentId) +
            '> rendered through the forwardRef fallback — a wrapper fiber was created. ' +
            'The element was made outside the wrapped JSX runtime/createElement patch ' +
            '(unwrapped runtime, memo()/lazy() around the styled component, or a ' +
            'third-party createElement). Rendering is correct, but the fiber win is ' +
            'lost for this component.'
        )
      }
      const r = patchImpl.resolveDescriptor(element, props)
      return React.createElement(r.type, ref == null ? r.props : Object.assign({}, r.props, { ref }))
    })

    element[IS_STYLED] = element // hoisting-proof self-reference discriminator
    element.component = component
    element.componentId = componentId
    element.styledComponentId = componentId // component-selector target
    element.group = engine.nextGroup() // definition order -> sheet cascade order
    element.parts = parts
    element.css = precompiled
    element.isStatic = isStatic
    element.target = component
    if (displayName) element.displayName = displayName
    element.toString = function () {
      return '.' + componentId
    }

    // styled-components FOLD interop. An untransformed chain over this
    // descriptor — styled(Stack).attrs(...)`` / .withConfig(...) — runs on real
    // styled-components, which sees styledComponentId, takes its FOLDING path,
    // and renders `target` directly: the descriptor is never created as an
    // element, so neither the JSX interception nor the forwardRef fallback can
    // resolve its styles. Instead SC reads the base's styles from
    // `componentStyle.generateAndInjectStyles(executionContext, ...)` per
    // render (and prepends `foldedComponentIds` + merges `attrs`). This shim
    // routes that call into OUR engine: static rules register under the
    // componentId, dynamic interpolations resolve against SC's merged
    // execution context (props + theme + attrs) into our hash class — the
    // rules live in the just-styled sheet, SC only carries the class names.
    // (Cross-sheet cascade ties with the SC wrapper's own rules remain the
    // documented limitation.)
    element.attrs = []
    element.foldedComponentIds = []
    element.componentStyle = {
      isStatic: isStatic,
      baseStyle: undefined,
      generateAndInjectStyles: function (executionContext) {
        return patchImpl.styleClassesFor(element, executionContext || {})
      },
    }

    // Statics passthrough: `styled(Dropdown)` must still expose `Dropdown.Item`
    // (compound components), custom statics, defaultProps, etc.
    // styled-components does this by COPYING non-React statics
    // (hoist-non-react-statics) with an exclusion list for its own internals; a
    // prototype link gives the same property-access semantics with no copy and
    // no collision risk — every field assigned above is an OWN property that
    // shadows the base, and anything else falls through the chain (including
    // through styled(styled(X)) descriptor chains). ORDER MATTERS: the link
    // must come AFTER the own-field assignments — real styled-components v6
    // components carry a NON-WRITABLE `toString`, and in strict mode assigning
    // through a prototype chain that holds a read-only property throws
    // ("Cannot assign to read only property 'toString'"). With the fields
    // already own, the proto swap can't interfere. String tags have no statics.
    if (component !== null && (typeof component === 'object' || typeof component === 'function')) {
      try {
        Object.setPrototypeOf(element, component)
      } catch (e) {
        /* exotic base: statics passthrough is best-effort */
      }
    }

    return element
  }
}

module.exports = {
  IS_STYLED,
  createStyled,
  // Root createElement for the automatic runtime's key-after-spread fallback
  // (imported from the import-source root), wrapped to resolve descriptors.
  createElement: patchImpl.wrapCreateElement(React.createElement),
  Fragment: React.Fragment,
  getCss: sheet.getCss,
  renderStaticStyles: sheet.renderStaticStyles,
  // Vendor prefixing is opt-in (styled-components v6 parity). Call once at
  // startup; pair with the babel plugin's `vendorPrefixes: true` so build-time
  // precompiled rules match.
  setVendorPrefixes: engine.setVendorPrefixes,
  __resetSheet: function () {
    sheet.__resetSheet()
    engine.__reset()
  },
  installCreateElementPatch: patchImpl.installCreateElementPatch,
  uninstallCreateElementPatch: patchImpl.uninstallCreateElementPatch,
  // Diagnostics: how many descriptor renders paid a wrapper fiber (forwardRef
  // fallback). 0 = every styled element was resolved at creation, as intended.
  __getFallbackRenders: function () {
    return fallbackRenders
  },
}
