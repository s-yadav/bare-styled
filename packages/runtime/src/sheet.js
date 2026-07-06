// Singleton style sheet shared by every descriptor in the app.
// In the browser rules are appended to a single <style data-just-styled>
// element; without a DOM they are collected in memory for SSR.
// CommonJS on purpose: this package ships source, and consumers (jest,
// bundlers, node) all load it without a transform step.
'use strict'

const rules = new Map()

let styleElement = null

function getStyleElement() {
  if (styleElement && styleElement.parentNode) return styleElement
  styleElement = document.createElement('style')
  styleElement.setAttribute('data-just-styled', '')
  document.head.appendChild(styleElement)
  return styleElement
}

// Registers a compiled rule, deduped by className. The css string already
// contains the full `.className{...}` rule produced at build time.
function registerRule(className, css) {
  if (rules.has(className)) return
  rules.set(className, css)
  if (typeof document !== 'undefined') {
    getStyleElement().appendChild(document.createTextNode(css))
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
}

module.exports = {
  registerRule,
  getCss,
  renderStaticStyles,
  __resetSheet,
}
