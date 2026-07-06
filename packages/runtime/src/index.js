// Public runtime entry point (`just-styled/runtime`).
// CommonJS on purpose: this package ships source, and consumers (jest,
// bundlers, node) all load it without a transform step.
'use strict'

const React = require('react')
const sheet = require('./sheet')
const patchImpl = require('./patch-impl')

// Shared symbol so the createElement patch can recognize descriptors even
// when app code and the runtime resolve to different module instances.
const IS_STYLED = Symbol.for('just-styled')

// Builds the descriptor the babel plugin emits in place of a styled call.
// Registering the precompiled css into the sheet happens here, once per
// className, as a side effect of module evaluation in the compiled app.
//
// The descriptor is a `forwardRef` object carrying the styled-components
// component contract (see the field block below), so it is a valid element
// type for react-is and a first-class styled component for styled-components:
// it can be a `styled(Descriptor)` target and can be interpolated as a
// component selector. With the patch/jsx wrapper installed, resolution
// intercepts on IS_STYLED before React ever renders the forwardRef, so the
// descriptor collapses to its host element with no extra fiber — the render
// body only runs in the full-fidelity fallback (`as`/`theme`) or in an
// environment with neither the wrapper nor the patch.
function createStyledElement(desc) {
  let styledComponent

  const element = React.forwardRef(function JustStyled(props, ref) {
    return React.createElement(
      element.getStyledComponent(),
      ref == null ? props : Object.assign({}, props, { ref })
    )
  })

  // Discriminator: a self-reference under the shared global symbol. A raw
  // descriptor has `element[IS_STYLED] === element`. When a real styled
  // component wraps a descriptor, styled-components hoists the descriptor's own
  // symbols (via hoist-non-react-statics) onto the wrapper — but it copies the
  // *value*, which still points at the original descriptor, so on the wrapper
  // `wrapper[IS_STYLED] !== wrapper`. That lets the patch tell a genuine
  // descriptor from a contaminated wrapper even though the descriptor now
  // carries a `styledComponentId` (see below), which the old
  // `styledComponentId === undefined` check could no longer rely on.
  element[IS_STYLED] = element
  element.component = desc.component
  element.className = desc.className
  element.componentId = desc.componentId
  if (desc.displayName) element.displayName = desc.displayName

  // styled-components interop. `React.forwardRef` already set `$$typeof` to the
  // forward-ref symbol; adding `styledComponentId` makes `isStyledComponent`
  // true, so the descriptor is a first-class component *selector*: interpolating
  // it into another template (`${Comp} { ... }`) yields `.<className>` (the very
  // class it renders with) instead of being invoked or stringified as a style
  // object — behavior that otherwise differs across styled-components 6.x. The
  // remaining fields are the minimal contract `styled(Descriptor)` folding reads
  // (its own css already lives in the just-styled sheet, so it contributes no
  // extra rules).
  element.styledComponentId = desc.className
  element.target = desc.component
  element.attrs = []
  element.foldedComponentIds = ''
  element.componentStyle = {
    rules: [],
    isStatic: true,
    generateAndInjectStyles: function () {
      return ''
    },
  }

  element.getStyle = function () {
    return desc.css
  }

  // Evaluates the dynamic interpolations against the current props and
  // returns them as a css custom property map. Nullish and false results
  // are skipped, mirroring styled-components' empty interpolations.
  // Numbers pass through untouched; React serializes them correctly.
  element.getInlineStyles = function (props) {
    const styles = {}
    const vars = desc.vars || []
    for (let i = 0; i < vars.length; i++) {
      const name = vars[i][0]
      const value = vars[i][1](props)
      if (value === null || value === undefined || value === false) continue
      styles[name] = typeof value === 'number' ? value : String(value)
    }
    return styles
  }

  // Memoized construction of the real styled-components fallback. It is
  // only built when a render needs full fidelity (`as`, `theme`, or an
  // unpatched environment invoking the descriptor as a component).
  element.getStyledComponent = function () {
    if (styledComponent === undefined) {
      styledComponent = desc.fallback()
    }
    return styledComponent
  }

  // Interpolating a descriptor into other css yields its selector, the
  // same contract styled-components components have.
  element.toString = function () {
    return '.' + desc.className
  }

  sheet.registerRule(desc.className, desc.css)

  return element
}

module.exports = {
  IS_STYLED,
  createStyledElement,
  // When a bundler's automatic JSX runtime points its `jsxImportSource` at
  // just-styled, it imports `jsx`/`jsxs`/`Fragment` from `just-styled/jsx-runtime`
  // — but for the key-after-spread case (`<C {...x} key={k}/>`, ubiquitous in
  // `.map()`) it falls back to `createElement` imported from the import-source
  // *root* (this module). So the root must provide a `createElement` (and
  // `Fragment`). It is wrapped so descriptors resolve on this path too.
  createElement: patchImpl.wrapJsx(React.createElement),
  Fragment: React.Fragment,
  getCss: sheet.getCss,
  renderStaticStyles: sheet.renderStaticStyles,
  __resetSheet: sheet.__resetSheet,
  installCreateElementPatch: patchImpl.installCreateElementPatch,
  uninstallCreateElementPatch: patchImpl.uninstallCreateElementPatch,
  __getInlineRegistrySize: patchImpl.__getInlineRegistrySize,
}
