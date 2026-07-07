/**
 * @jest-environment jsdom
 *
 * End-to-end for the three-phase (lazy) descriptor: `createStyled` keeps the
 * template live, flattens once on first render (cached), and either resolves to
 * a plain host element with a static rule + CSS vars, or bails to the real
 * styled-components component. Rendered with react-dom/client into a real DOM.
 */
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { css } from 'styled-components'
import {
  createStyled,
  installCreateElementPatch,
  uninstallCreateElementPatch,
  getCss,
  __resetSheet,
} from 'just-styled/runtime'

global.IS_REACT_ACT_ENVIRONMENT = true

const theme = { color: { bg: '#eee' } }

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

const render = el => act(() => { createRoot(container).render(el) })

test('static component: shared fragment + module theme resolve to one rule, no var', () => {
  const shared = css`
    color: red;
    background-color: ${theme.color.bg};
  `
  const Card = createStyled('div', { componentId: 'sc-card', displayName: 'Card' })`
    width: 400px;
    ${shared}
  `
  render(React.createElement(Card, null, 'hi'))

  const el = container.querySelector('div')
  expect(el.className).toContain('sc-card')
  expect(el.getAttribute('style')).toBeNull() // no dynamic vars
  const cssText = getCss()
  expect(cssText).toMatch(/\.sc-card\{[^}]*width:\s*400px/)
  expect(cssText).toMatch(/background-color:\s*#eee/)
})

test('value-position function resolves to a CSS variable, updated in place', () => {
  const Button = createStyled('button', { componentId: 'sc-btn' })`
    color: ${props => props.color};
    font-size: 14px;
  `
  render(React.createElement(Button, { color: 'tomato' }, 'x'))

  const el = container.querySelector('button')
  expect(el.className).toContain('sc-btn')
  expect(el.getAttribute('style')).toMatch(/--sc-btn-0:\s*tomato/)
  expect(getCss()).toMatch(/\.sc-btn\{color:var\(--sc-btn-0\);/)
})

test('block/conditional function bails to the real styled-components component', () => {
  const Box = createStyled('div', { componentId: 'sc-box' })`
    ${props => props.on && 'background: gray;'}
  `
  render(React.createElement(Box, { on: true }, 'y'))

  // Rendered (via the SC fallback), and NO just-styled static rule was
  // registered for it (ensure() bailed before registering).
  expect(container.querySelector('div')).not.toBeNull()
  expect(container.textContent).toBe('y')
  expect(getCss()).not.toMatch(/\.sc-box\{/)
})

test('flatten runs once and is cached across renders', () => {
  let calls = 0
  const Dyn = createStyled('div', { componentId: 'sc-dyn' })`
    color: ${props => { calls++; return props.color }};
  `
  render(React.createElement(Dyn, { color: 'red' }))
  render(React.createElement(Dyn, { color: 'blue' }))
  // The interpolation fn runs per render (to compute the var value), but the
  // rule is registered exactly once.
  const rules = getCss().match(/\.sc-dyn\{/g) || []
  expect(rules).toHaveLength(1)
  expect(container.querySelector('div').getAttribute('style')).toMatch(/--sc-dyn-0:\s*blue/)
})
