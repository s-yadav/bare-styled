/** @jest-environment jsdom */
// styled(StyledComponent) cascade WITHOUT folding: base and extender keep their
// own separate rules (each traceable to its component in DevTools, like
// styled-components). The extender wins because resolveDescriptor registers the
// base chain's rules BEFORE the extender's, so the extender's rule is inserted
// later and wins on equal specificity — matching styled-components' definition-
// order guarantee. (File name kept for history; these are ordering tests.)
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { createStyled, installCreateElementPatch, uninstallCreateElementPatch, getCss, __resetSheet } from 'just-styled/runtime'

global.IS_REACT_ACT_ENVIRONMENT = true

let container
beforeEach(() => {
  installCreateElementPatch()
  container = document.createElement('div')
  document.body.appendChild(container)
})
afterEach(() => {
  uninstallCreateElementPatch()
  __resetSheet()
  document.head.innerHTML = ''
  document.body.innerHTML = ''
})
const render = el => act(() => createRoot(container).render(el))

it('static styled(Styled): separate rules, base before extender, extender wins', () => {
  const Button = createStyled('button', { componentId: 'sc-btn' })`padding: 6px 12px; color: black;`
  const IconButton = createStyled(Button, { componentId: 'sc-icon' })`padding: 4px 8px;`
  render(React.createElement(IconButton, null, 'x'))

  const el = container.querySelector('button')
  expect(el).not.toBeNull()
  expect(el.className).toContain('sc-btn') // both component ids on the element
  expect(el.className).toContain('sc-icon')

  const css = getCss()
  // TWO separate rules — each carries only its own component's declarations
  const btnRule = css.match(/\.sc-btn\{([^}]*)\}/)[1]
  const iconRule = css.match(/\.sc-icon\{([^}]*)\}/)[1]
  expect(btnRule).toContain('color:black')
  expect(btnRule).toContain('padding:6px 12px')
  expect(iconRule).toContain('padding:4px 8px')
  expect(iconRule).not.toContain('color:black') // NOT merged — stays traceable

  // base rule inserted before the extender's -> extender's padding wins
  expect(css.indexOf('.sc-btn{')).toBeLessThan(css.indexOf('.sc-icon{'))
})

it('dynamic base + static extender: base hash rule before extender rule', () => {
  const Box = createStyled('div', { componentId: 'sc-dyn' })`background: ${p => p.bg};`
  const Padded = createStyled(Box, { componentId: 'sc-pad' })`padding: 4px;`
  render(React.createElement(Padded, { bg: 'red' }, 'y'))

  const el = container.querySelector('div')
  expect(el.className).toContain('sc-pad')
  expect(el.className).toContain('sc-dyn')
  const jsCls = el.className.split(' ').find(c => c.startsWith('js-'))
  const css = getCss()
  expect(css.match(new RegExp('\\.' + jsCls + '\\{([^}]*)\\}'))[1]).toContain('background:red')
  expect(css).toContain('.sc-pad{padding:4px;}')
  // base's (dynamic) rule inserted before the extender's rule
  expect(css.indexOf('.' + jsCls + '{')).toBeLessThan(css.indexOf('.sc-pad{'))
})

it('extender wins even when its css matches an unrelated component rendered earlier', () => {
  // Regression: with global content-dedup this failed — the extender's rule
  // shared the unrelated component's early sheet position, so the base's rule
  // (inserted later) won. Group ordering fixes it: each component's rule lives in
  // its own definition-order group, so the base group precedes the extender group.
  const Other = createStyled('div', { componentId: 'sc-other' })`color: ${p => p.c};`
  const Stack = createStyled('div', { componentId: 'sc-stack' })`color: ${p => p.baseC};`
  const StyledStack = createStyled(Stack, { componentId: 'sc-ss' })`color: ${p => p.c};`

  render(React.createElement(Other, { c: 'red' })) // inserts a color:red rule first
  render(React.createElement(StyledStack, { baseC: 'blue', c: 'red' }))

  const css = getCss()
  const el = container.querySelector('.sc-ss')
  const jsClasses = el.className.split(' ').filter(x => x.startsWith('js-'))
  const ruleOf = k => (css.match(new RegExp('\\.' + k + '\\{([^}]*)\\}')) || [])[1]
  const baseCls = jsClasses.find(k => /blue/.test(ruleOf(k) || ''))
  const extCls = jsClasses.find(k => /red/.test(ruleOf(k) || ''))
  // extender's red rule must come AFTER the base's blue rule -> red wins
  expect(css.indexOf('.' + extCls + '{')).toBeGreaterThan(css.indexOf('.' + baseCls + '{'))
})

it('dynamic composition keeps base-before-extender across prop changes', () => {
  // Each prop change mints new rules; positional-by-group insertion keeps every
  // base variant ahead of every extender variant, even though within a render the
  // extender's rule is registered before the base's.
  const Base = createStyled('div', { componentId: 'sc-base' })`color: ${p => p.bc};`
  const Ext = createStyled(Base, { componentId: 'sc-ext' })`background: ${p => p.bg};`
  const root = createRoot(container)
  act(() => root.render(React.createElement(Ext, { bc: 'red', bg: 'black' })))
  act(() => root.render(React.createElement(Ext, { bc: 'blue', bg: 'white' }))) // new rules both

  const css = getCss()
  const el = container.querySelector('div')
  const cls = el.className.split(' ').filter(x => x.startsWith('js-'))
  const ruleOf = k => (css.match(new RegExp('\\.' + k + '\\{([^}]*)\\}')) || [])[1]
  // currently-applied base (blue) rule must precede the extender (white bg) rule
  const baseCls = cls.find(k => /blue/.test(ruleOf(k) || ''))
  const extCls = cls.find(k => /white/.test(ruleOf(k) || ''))
  expect(css.indexOf('.' + baseCls + '{')).toBeLessThan(css.indexOf('.' + extCls + '{'))

  // stronger: EVERY base-group rule (color:) precedes EVERY extender-group rule (background:)
  const idxs = re => [...css.matchAll(re)].map(m => css.indexOf('.' + m[1] + '{'))
  const baseIdxs = idxs(/\.(js-[a-z0-9]+)\{color:/g)
  const extIdxs = idxs(/\.(js-[a-z0-9]+)\{background:/g)
  expect(baseIdxs).toHaveLength(2) // two prop values -> two rules per component
  expect(extIdxs).toHaveLength(2)
  expect(Math.max(...baseIdxs)).toBeLessThan(Math.min(...extIdxs))
})

it('three-level styled(styled(styled)): rules ordered a < b < c, deepest wins', () => {
  const A = createStyled('a', { componentId: 'sc-a' })`color: red;`
  const B = createStyled(A, { componentId: 'sc-b' })`color: green;`
  const C = createStyled(B, { componentId: 'sc-c' })`color: blue;`
  render(React.createElement(C, null, 'link'))

  const el = container.querySelector('a')
  expect(el.className).toContain('sc-a')
  expect(el.className).toContain('sc-b')
  expect(el.className).toContain('sc-c')
  const css = getCss()
  expect(css.indexOf('.sc-a{')).toBeLessThan(css.indexOf('.sc-b{'))
  expect(css.indexOf('.sc-b{')).toBeLessThan(css.indexOf('.sc-c{'))
})
