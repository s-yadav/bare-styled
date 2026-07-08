/** @jest-environment jsdom */
// Idle precompilation of static rules: a static (non-precompiled) descriptor is
// queued at definition time and its rule string is compiled during a
// requestIdleCallback, BEFORE first render — but DOM insertion stays lazy (only
// rendered components hit the sheet). We drive requestIdleCallback synchronously
// so the queue drains at definition time. require() (not import) so the shim is
// installed before the runtime module — and thus the engine's `ric` binding — is
// first loaded in this file's registry.
global.requestIdleCallback = cb => cb({ timeRemaining: () => 50, didTimeout: false })

const React = require('react')
const { act } = require('react')
const { createRoot } = require('react-dom/client')
const { createStyled, getCss, __resetSheet } = require('just-styled/runtime')

global.IS_REACT_ACT_ENVIRONMENT = true

let container
beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
})
afterEach(() => {
  __resetSheet()
  document.head.innerHTML = ''
  document.body.innerHTML = ''
})
const render = el => act(() => createRoot(container).render(el))

afterAll(() => {
  delete global.requestIdleCallback
})

it('precomputes a static rule at idle time but does NOT insert it until render', () => {
  // Defining the component queues it; the synchronous rIC shim drains the queue
  // immediately, so the rule is compiled — but the sheet stays empty (lazy DOM).
  const Box = createStyled('div', { componentId: 'sc-idle' })`color: rebeccapurple;`
  expect(getCss()).not.toContain('sc-idle')

  // First render inserts the (already-precomputed) rule into the sheet.
  render(React.createElement(Box, null, 'x'))
  expect(container.querySelector('div').className).toBe('sc-idle')
  expect(getCss()).toMatch(/\.sc-idle\{color:rebeccapurple;\}/)
})

it('still works when the same descriptor renders after a __resetSheet', () => {
  const Box = createStyled('div', { componentId: 'sc-idle2' })`color: teal;`
  render(React.createElement(Box, null, '1'))
  expect(getCss()).toMatch(/\.sc-idle2\{color:teal;\}/)
  __resetSheet()
  render(React.createElement(Box, null, '2'))
  expect(getCss()).toMatch(/\.sc-idle2\{color:teal;\}/)
})
