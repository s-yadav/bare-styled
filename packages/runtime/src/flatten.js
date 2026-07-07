// Module-load / first-render flatten.
//
// The compile step now only transpiles `styled.tag`...`` to a `createStyled`
// call that keeps the template's interpolations LIVE. This module turns that
// live template into a final CSS string at runtime (once, cached by the
// descriptor). Because interpolations are real values here, module-scope
// things that the old build-time analyzer had to bail on — imported `css`
// fragments, module `theme` values, `${StyledComponent}` selectors, style
// objects — all resolve.
//
// We deliberately reuse styled-components' own `css()` to do the heavy lifting:
// it resolves module values, inlines nested fragments, serializes style
// objects, and turns `${StyledComponent}` into its `.selector`, returning a
// flat array in which ONLY functions (prop-dependent) remain unresolved. We
// then only have to decide, per function: value position -> CSS variable;
// anywhere else -> bail to a real styled component.
'use strict'

const { compile, serialize, stringify, middleware, prefixer } = require('stylis')

// styled-components is an optional peer. It is required for the flatten (and
// for the fallback), so if it is absent every component bails.
let scCss = null
try {
  scCss = require('styled-components').css
} catch (e) {
  scCss = null
}

const SC_KEYFRAMES = Symbol.for('sc-keyframes')

// Value position = since the last `;`, `{`, or `}` there is a `property:` with
// an open (unterminated) value. That is the only place a bare `var(--x)` token
// is valid. Selector/property/block positions fail this and force a bail.
const VALUE_TAIL = /(?:^|[;{}])\s*[-a-zA-Z][a-zA-Z0-9-]*\s*:[^;{}]*$/

function isValuePosition(accumulated) {
  return VALUE_TAIL.test(accumulated)
}

// Returns { bail: true } or { bail: false, css, vars }.
// `css` is the raw (uncompiled) rule body with `var(--…)` substituted for
// value-position functions; `vars` is [[varName, fn], …].
function flatten(strings, interps, componentId) {
  if (!scCss) return { bail: true }

  let parts
  try {
    parts = scCss(strings, ...interps)
  } catch (e) {
    // e.g. a bare keyframes interpolation styled-components refuses to flatten.
    return { bail: true }
  }

  let out = ''
  const vars = []
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]
    if (typeof part === 'string') {
      out += part
      continue
    }
    if (typeof part === 'function') {
      // Prop-dependent. Only safe as a CSS variable in value position;
      // conditional blocks, selector interpolations, etc. bail.
      if (!isValuePosition(out)) return { bail: true }
      const name = '--' + componentId + '-' + vars.length
      out += 'var(' + name + ')'
      vars.push([name, part])
      continue
    }
    // Keyframes objects (and anything else css() leaves unresolved) need
    // machinery we don't do statically yet — bail to the real component.
    if (part && typeof part === 'object' && part[SC_KEYFRAMES]) {
      return { bail: true }
    }
    return { bail: true }
  }

  return { bail: false, css: out, vars }
}

// Compile a resolved rule body into a final stylesheet rule under `className`,
// with the same stylis pipeline styled-components uses.
function buildRule(className, cssBody) {
  return serialize(
    compile('.' + className + '{' + cssBody + '}'),
    middleware([prefixer, stringify])
  )
}

module.exports = { flatten, buildRule, isValuePosition }
