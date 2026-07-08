// Singleton style sheet shared by every descriptor in the app.
// In the browser rules are appended to a single <style data-just-styled>
// element; without a DOM they are collected in memory for SSR.
// CommonJS on purpose: this package ships source, and consumers (jest,
// bundlers, node) all load it without a transform step.
'use strict'

const rules = new Map()

let styleElement = null
let cssomSheet = null

function getStyleElement() {
  if (styleElement && styleElement.parentNode) return styleElement
  styleElement = document.createElement('style')
  styleElement.setAttribute('data-just-styled', '')
  document.head.appendChild(styleElement)
  cssomSheet = styleElement.sheet || null
  return styleElement
}

// Split a compiled css string into individual top-level rules (CSSOM
// `insertRule` takes one rule at a time). Splits at brace depth 0, so
// `@media{...}` blocks stay intact as a single rule.
function splitRules(css) {
  const out = []
  let depth = 0
  let start = 0
  for (let i = 0; i < css.length; i++) {
    const ch = css.charCodeAt(i)
    if (ch === 123) depth++ // {
    else if (ch === 125) {
      // }
      depth--
      if (depth === 0) {
        out.push(css.slice(start, i + 1))
        start = i + 1
      }
    }
  }
  return out
}

// Registers a compiled rule, deduped by className. In the browser we use the
// CSSOM `insertRule` API (incremental, no stylesheet re-parse) instead of
// appending text nodes — appending thousands of text nodes forces repeated
// re-parses of the growing sheet and stalls the main thread. Memory `rules`
// is still kept as the source of truth for getCss()/SSR.
function registerRule(className, css) {
  if (rules.has(className)) return
  rules.set(className, css)
  if (typeof document === 'undefined') return
  const el = getStyleElement()
  const sheet = cssomSheet || el.sheet
  if (sheet && typeof sheet.insertRule === 'function') {
    const parts = splitRules(css)
    for (let i = 0; i < parts.length; i++) {
      try {
        sheet.insertRule(parts[i], sheet.cssRules.length)
      } catch (e) {
        // Fall back to text for anything the CSSOM rejects.
        el.appendChild(document.createTextNode(parts[i]))
      }
    }
  } else {
    el.appendChild(document.createTextNode(css))
  }
}

// All registered css concatenated in registration order.
function getCss() {
  let css = ''
  rules.forEach(rule => {
    css += rule
  })
  return css
}

// Full <style> tag string for embedding in server-rendered HTML.
function renderStaticStyles() {
  return '<style data-just-styled>' + getCss() + '</style>'
}

// Test-only helper. Clears collected rules and removes the injected tag.
function __resetSheet() {
  rules.clear()
  if (styleElement && styleElement.parentNode) {
    styleElement.parentNode.removeChild(styleElement)
  }
  styleElement = null
  cssomSheet = null
}

module.exports = {
  registerRule,
  getCss,
  renderStaticStyles,
  __resetSheet,
}
