// Singleton style sheet shared by every descriptor in the app.
//
// Rules are ordered by GROUP — a per-component number assigned in definition
// (module-load) order — mirroring styled-components. A rule is inserted at the
// end of its group's span, so every rule of a lower group precedes every rule of
// a higher group in the sheet, regardless of the order components first render.
// Because a base component is always defined before a component that extends it,
// base rules always precede extender rules, so the extender wins the cascade on
// equal specificity — without folding and without any render-time reordering.
//
// In the browser rules go into a single <style data-just-styled> via the CSSOM
// insertRule API (positional). Without a DOM they are collected in memory for
// SSR/getCss, still in group order. Rules the CSSOM rejects go into a SEPARATE
// <style data-just-styled-fallback> as text — never into the main element:
// mutating a <style>'s text content makes the browser re-parse it and REPLACE
// its CSSStyleSheet, silently discarding every rule previously added via
// insertRule. (Rejected rules are typically selectors the engine can't parse
// anyway — e.g. another vendor's pseudo-elements — so best-effort text is fine.)
'use strict'

const registered = new Set() // className -> inserted once (dedup)
const groupRules = [] // groupRules[g] = [rule, ...] in insertion order (memory / SSR / getCss)
const groupSizes = [] // groupSizes[g] = # of CSSOM rules inserted for group g (browser index math)

let styleElement = null
let cssomSheet = null
let fallbackElement = null // text-only element for CSSOM-rejected rules

function getStyleElement() {
  if (styleElement && styleElement.parentNode) return styleElement
  styleElement = document.createElement('style')
  styleElement.setAttribute('data-just-styled', '')
  document.head.appendChild(styleElement)
  cssomSheet = styleElement.sheet || null
  return styleElement
}

function getFallbackElement() {
  if (fallbackElement && fallbackElement.parentNode) return fallbackElement
  fallbackElement = document.createElement('style')
  fallbackElement.setAttribute('data-just-styled-fallback', '')
  document.head.appendChild(fallbackElement)
  return fallbackElement
}

// Split a compiled css string into individual top-level rules (CSSOM insertRule
// takes one rule at a time). Only used for the plugin's build-time precompiled
// strings — the engine passes rules as an array, collected one at a time by
// stylis's rulesheet middleware at serialize time. Splits at brace depth 0
// (@media{...} blocks stay intact) and ignores braces inside quoted strings
// (content:"}" must not end a rule).
function splitRules(css) {
  const out = []
  let depth = 0
  let start = 0
  let quote = 0 // charCode of the open quote, 0 when outside strings
  for (let i = 0; i < css.length; i++) {
    const ch = css.charCodeAt(i)
    if (quote) {
      if (ch === 92) i++ // backslash: skip escaped char
      else if (ch === quote) quote = 0
      continue
    }
    if (ch === 34 || ch === 39) quote = ch // " or '
    else if (ch === 123) depth++ // {
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

// ---- group offset math -------------------------------------------------------
// groupStart(g) = sum of all lower groups' sizes. A naive loop is O(G) per rule
// insert; with thousands of styled definitions (groups) that's O(G) work on the
// mount path for every first-seen rule. A Fenwick (binary indexed) tree over
// groupSizes makes both the prefix-sum query and the size increment O(log G).
// The tree mirrors groupSizes (which stays the plain source of truth); it is
// rebuilt on capacity growth (rare, amortized) and zeroed on __resetSheet.
let bit = new Uint32Array(2048) // 1-based; bit[j] covers a range of groups ending at j-1

function bitEnsure(count) {
  // need indices 1..count addressable
  if (count < bit.length) return
  let cap = bit.length
  while (cap <= count) cap <<= 1
  bit = new Uint32Array(cap)
  // Rebuild from groupSizes: extending a Fenwick tree in place is unsound (new
  // high nodes would be missing prior updates), and this path is rare.
  for (let g = 0; g < groupSizes.length; g++) {
    const size = groupSizes[g]
    if (size) for (let j = g + 1; j < bit.length; j += j & -j) bit[j] += size
  }
}

function bitAdd(group, delta) {
  for (let j = group + 1; j < bit.length; j += j & -j) bit[j] += delta
}

// Index of the first CSSOM rule of group g (sum of all lower groups' sizes).
function groupStart(g) {
  bitEnsure(g)
  let n = 0
  for (let j = g; j > 0; j -= j & -j) n += bit[j]
  return n
}

// Register a compiled rule for `group`, deduped by className. `css` is either an
// array of individual rules (from the engine's rulesheet-collected serialize) or
// a compiled string (the plugin's build-time precompiled css), split here. New
// rules are inserted at the END of their group's span, keeping the sheet ordered
// by group.
function registerRule(group, className, css) {
  if (registered.has(className)) return
  registered.add(className)
  const parts = Array.isArray(css) ? css : splitRules(css)
  const bucket = groupRules[group] || (groupRules[group] = [])
  for (let i = 0; i < parts.length; i++) bucket.push(parts[i])

  if (typeof document === 'undefined') return
  const el = getStyleElement()
  const sheet = cssomSheet || el.sheet
  if (sheet && typeof sheet.insertRule === 'function') {
    bitEnsure(group + 1)
    let idx = groupStart(group) + (groupSizes[group] || 0) // end of this group's span
    for (let i = 0; i < parts.length; i++) {
      try {
        sheet.insertRule(parts[i], idx)
        idx++
        groupSizes[group] = (groupSizes[group] || 0) + 1
        bitAdd(group, 1)
      } catch (e) {
        // CSSOM rejected the rule (e.g. a selector this browser can't parse).
        // Text goes to the SEPARATE fallback element — appending text to the
        // main element would re-parse it and wipe its insertRule'd sheet.
        getFallbackElement().appendChild(document.createTextNode(parts[i]))
      }
    }
  } else {
    // No CSSOM at all: pure text mode on the main element (nothing to wipe).
    for (let i = 0; i < parts.length; i++) el.appendChild(document.createTextNode(parts[i]))
  }
}

// All registered css concatenated in group order (source of truth for SSR).
function getCss() {
  let css = ''
  for (let g = 0; g < groupRules.length; g++) {
    const arr = groupRules[g]
    if (arr) for (let i = 0; i < arr.length; i++) css += arr[i]
  }
  return css
}

// Full <style> tag string for embedding in server-rendered HTML.
function renderStaticStyles() {
  return '<style data-just-styled>' + getCss() + '</style>'
}

// Test-only helper. Clears collected rules and removes the injected tag.
function __resetSheet() {
  registered.clear()
  groupRules.length = 0
  groupSizes.length = 0
  bit.fill(0)
  if (styleElement && styleElement.parentNode) {
    styleElement.parentNode.removeChild(styleElement)
  }
  if (fallbackElement && fallbackElement.parentNode) {
    fallbackElement.parentNode.removeChild(fallbackElement)
  }
  styleElement = null
  cssomSheet = null
  fallbackElement = null
}

module.exports = {
  registerRule,
  getCss,
  renderStaticStyles,
  __resetSheet,
}
