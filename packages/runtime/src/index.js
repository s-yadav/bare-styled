// Public runtime entry point (`bare-styled/runtime`).
// CommonJS on purpose: this package ships source, and consumers (jest,
// bundlers, node) all load it without a transform step.
'use strict'

const React = require('react')
const sheet = require('./sheet')
const patchImpl = require('./patch-impl')
const engine = require('./engine')

// Shared global symbol so the patch/jsx runtime recognizes descriptors even
// across duplicate runtime copies.
const IS_STYLED = Symbol.for('bare-styled')

// Descriptor renders that paid a wrapper fiber (forwardRef fallback).
// Should stay 0 in a correctly wired app.
let fallbackRenders = 0

// The plugin emits `createStyled(component, { componentId, ... })`tpl``.
// styled(StyledComponent) is NOT folded: base and extender keep their own
// rules; the extender wins the cascade via sheet group ordering (groups are
// assigned in definition order, and a base is defined before its extender).
function createStyled(component, config) {
  const componentId = config.componentId
  const displayName = config.displayName
  const precompiled = config.css // build-time stylis-serialized rule for a fully-static template
  const ownAttrs = config.attrs || null // .attrs(objOrFn) chain, in application order
  const shouldForwardProp = config.shouldForwardProp // .withConfig custom prop filter
  const forwardProps = config.forwardProps // .withConfig one-call prop shaping (props) => nextProps
  const skeletonCfg = config.skeleton // build-compiled rule w/ __bsc__ + var(--bs-N) tokens
  const varsCfg = config.vars // live expressions, in placeholder order
  const tag = function (strings) {
    const interps = Array.prototype.slice.call(arguments, 1)

    // Resolution mode, decided once at definition: precompiled (rule ships
    // finished) / skeleton (stylis ran at build; non-function vars substitute
    // now, promoting to static if no fns remain) / live template.
    let parts = null
    let css = precompiled
    let varFns = null
    let segments = null
    let isStatic
    if (precompiled != null) {
      isStatic = true
    } else if (skeletonCfg != null) {
      const sub = engine.substituteStaticVars(skeletonCfg, varsCfg || [])
      if (sub.fns.length === 0) {
        isStatic = true
        css = sub.skeleton.split('__bsc__').join(componentId) // promote: finished rule
      } else {
        isStatic = false
        varFns = sub.fns
        segments = engine.parseSkeleton(sub.skeleton)
      }
    } else {
      parts = engine.cacheParts(strings, interps)
      isStatic = engine.isStatic(parts)
      // Queue the remaining stylis compile for idle time, off the render path.
      if (isStatic) engine.queueStatic(componentId, parts)
    }

    // Chain attrs apply base-first (extender overrides), precomputed flat so
    // the render path does zero chain walking.
    let attrsAll = null
    {
      const baseAll = component !== null && component !== undefined && component._attrsAll
      if (baseAll && ownAttrs) attrsAll = baseAll.concat(ownAttrs)
      else if (baseAll) attrsAll = baseAll
      else if (ownAttrs) attrsAll = ownAttrs
    }
    // Chain-effective shouldForwardProp / forwardProps: extender wins, else
    // inherit the base's. forwardProps beats shouldForwardProp at resolution.
    const sfp =
      shouldForwardProp ||
      (component !== null && component !== undefined && component._sfp) ||
      undefined
    const fwd =
      forwardProps ||
      (component !== null && component !== undefined && component._fwd) ||
      undefined

    // forwardRef fallback: renders correctly if the descriptor reaches React
    // without being intercepted at element creation (unwrapped runtime,
    // memo()/lazy() unwrapping internally, third-party createElement) — at the
    // cost of a wrapper fiber. Warns once per component in dev.
    const element = React.forwardRef(function BareStyled(props, ref) {
      fallbackRenders++
      if (
        typeof process !== 'undefined' &&
        process.env.NODE_ENV !== 'production' &&
        !element._warnedFallback
      ) {
        element._warnedFallback = true
        // eslint-disable-next-line no-console
        console.warn(
          '[bare-styled] <' +
            (element.displayName || componentId) +
            '> rendered through the forwardRef fallback — a wrapper fiber was created. ' +
            'The element was made outside the wrapped JSX runtime/createElement patch ' +
            '(unwrapped runtime, memo()/lazy() around the styled component, or a ' +
            'third-party createElement). Rendering is correct, but the fiber win is ' +
            'lost for this component.'
        )
      }
      const r = patchImpl.unwrap(element, props) // full chain + attrs
      return React.createElement(r.type, ref == null ? r.props : Object.assign({}, r.props, { ref }))
    })

    element[IS_STYLED] = element // hoisting-proof self-reference discriminator
    element.component = component
    element.componentId = componentId
    element.styledComponentId = componentId // component-selector target
    element.group = engine.nextGroup() // definition order -> sheet cascade order
    element.parts = parts
    element.css = css
    element._varFns = varFns // skeleton mode: render-time value fns (placeholder order)
    element._segments = segments // skeleton mode: precompiled rule segments
    element.isStatic = isStatic
    element.target = component
    element._attrsAll = attrsAll // base-first flat attrs list (null when none)
    element._sfp = sfp // effective shouldForwardProp for the chain
    element._fwd = fwd // effective forwardProps for the chain (wins over _sfp)
    if (displayName) element.displayName = displayName
    element.toString = function () {
      return '.' + componentId
    }

    // styled-components FOLD interop: an untransformed styled(Descriptor)
    // chain runs on real SC, which sees styledComponentId, folds, and never
    // element-creates the descriptor — it reads styles via
    // componentStyle.generateAndInjectStyles instead. This shim routes that
    // into our engine. element.attrs is the REAL base-first list so a folding
    // SC applies our attrs itself (theme included); the shim then receives the
    // post-attrs context and must not re-apply them.
    element.attrs = attrsAll || []
    element.foldedComponentIds = []
    if (sfp) element.shouldForwardProp = sfp
    element.componentStyle = {
      isStatic: isStatic,
      baseStyle: undefined,
      generateAndInjectStyles: function (executionContext) {
        return patchImpl.styleClassesFor(element, executionContext || {})
      },
    }

    // Statics passthrough: styled(Dropdown) must still expose Dropdown.Item
    // etc. — a prototype link instead of hoist-non-react-statics copying.
    // ORDER MATTERS: the link must come AFTER the own-field assignments — SC v6
    // components carry a NON-WRITABLE toString, and assigning through a proto
    // chain holding a read-only property throws in strict mode.
    if (component !== null && (typeof component === 'object' || typeof component === 'function')) {
      try {
        Object.setPrototypeOf(element, component)
      } catch (e) {
        /* exotic base: statics passthrough is best-effort */
      }
    }

    return element
  }

  // Chainable factory: .attrs(a).withConfig(w)`...`. Each link returns a NEW
  // factory with accumulated config; ids/groups are consumed only when the
  // template is finally applied.
  tag.attrs = function (attrDef) {
    return createStyled(
      component,
      Object.assign({}, config, { attrs: (config.attrs || []).concat([attrDef]) })
    )
  }
  tag.withConfig = function (cfg) {
    const next = Object.assign({}, config)
    if (cfg) {
      if (cfg.componentId) next.componentId = cfg.componentId
      if (cfg.displayName) next.displayName = cfg.displayName
      if (cfg.shouldForwardProp) next.shouldForwardProp = cfg.shouldForwardProp
      if (cfg.forwardProps) next.forwardProps = cfg.forwardProps
    }
    return createStyled(component, next)
  }
  return tag
}

module.exports = {
  IS_STYLED,
  createStyled,
  // Root createElement for the automatic runtime's key-after-spread fallback.
  createElement: patchImpl.wrapCreateElement(React.createElement),
  Fragment: React.Fragment,
  getCss: sheet.getCss,
  renderStaticStyles: sheet.renderStaticStyles,
  // Opt-in (SC v6 parity); pair with the plugin's `vendorPrefixes: true`.
  setVendorPrefixes: engine.setVendorPrefixes,
  __resetSheet: function () {
    sheet.__resetSheet()
    engine.__reset()
  },
  installCreateElementPatch: patchImpl.installCreateElementPatch,
  uninstallCreateElementPatch: patchImpl.uninstallCreateElementPatch,
  // Diagnostics: descriptor renders that paid a wrapper fiber. Should be 0.
  __getFallbackRenders: function () {
    return fallbackRenders
  },
}
