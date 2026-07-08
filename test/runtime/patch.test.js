/** @jest-environment jsdom */
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import {
  createStyled,
  installCreateElementPatch,
  uninstallCreateElementPatch,
  getCss,
  __resetSheet,
} from 'just-styled/runtime'

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

describe('descriptor resolution (hash-class, no wrapper fiber)', () => {
  it('a STATIC native-tag descriptor uses just the componentId class (no hash)', () => {
    const Box = createStyled('div', { componentId: 'sc-box' })`color: red;`
    render(React.createElement(Box, null, 'hi'))
    const el = container.querySelector('div')
    expect(el.textContent).toBe('hi')
    expect(el.className).toBe('sc-box') // static -> componentId only, resolved once
    expect(getCss()).toMatch(/\.sc-box\{color:red;\}/)
  })

  it('re-registers a static rule after __resetSheet (descriptor outlives the sheet)', () => {
    // Regression: a module-level descriptor is created once and reused across
    // many sheet resets (e.g. repeated harness runs). A per-descriptor "done"
    // flag would survive the reset and suppress re-registration, leaving the
    // static css missing. The guard must track the sheet's lifetime instead.
    const Box = createStyled('div', { componentId: 'sc-reuse' })`color: green;`
    render(React.createElement(Box, null, '1'))
    expect(getCss()).toMatch(/\.sc-reuse\{color:green;\}/)

    __resetSheet()
    expect(getCss()).not.toContain('sc-reuse') // cleared

    render(React.createElement(Box, null, '2')) // same descriptor, fresh sheet
    expect(getCss()).toMatch(/\.sc-reuse\{color:green;\}/) // back in the DOM
  })

  it('re-registers a build-time precompiled (Opt 2) rule after __resetSheet', () => {
    const Box = createStyled('div', {
      componentId: 'sc-pre',
      css: '.sc-pre{display:flex;}', // plugin-precompiled, zero-interpolation
    })``
    render(React.createElement(Box, null, 'a'))
    expect(getCss()).toContain('.sc-pre{display:flex;}')
    __resetSheet()
    render(React.createElement(Box, null, 'b'))
    expect(getCss()).toContain('.sc-pre{display:flex;}')
  })

  it('distinct resolved styles get distinct classes; identical ones share', () => {
    const Btn = createStyled('button', { componentId: 'sc-b' })`color: ${p => p.color};`
    render(React.createElement('div', null,
      React.createElement(Btn, { color: 'red', key: 1 }, 'a'),
      React.createElement(Btn, { color: 'blue', key: 2 }, 'b'),
      React.createElement(Btn, { color: 'red', key: 3 }, 'c')))
    const cls = [...container.querySelectorAll('button')].map(b => b.className.split(' ')[1])
    expect(cls[0]).toBe(cls[2]) // same color -> same class
    expect(cls[0]).not.toBe(cls[1])
  })

  it('filters non-DOM props on native tags, keeps className/style/handlers', () => {
    const Box = createStyled('div', { componentId: 'sc-f' })`color: red;`
    render(React.createElement(Box, { variant: 'x', className: 'user', style: { margin: 1 } }, 'y'))
    const el = container.querySelector('div')
    expect(el.hasAttribute('variant')).toBe(false)
    expect(el.className).toMatch(/\buser\b/)
    expect(el.style.margin).toBe('1px')
  })

  it('styled(Component) forwards the (dynamic) class to the wrapped component (no token)', () => {
    function Inner({ className }) { return React.createElement('span', { id: 'leaf', className }) }
    const Wrapped = createStyled(Inner, { componentId: 'sc-w' })`background: ${p => p.color};`
    render(React.createElement(Wrapped, { color: 'red' }))
    const leaf = container.querySelector('#leaf')
    expect(leaf.className).toMatch(/^sc-w js-[a-z0-9]+$/) // dynamic -> componentId + hash
    expect(leaf.className).not.toContain('inline')
  })

  it('`as` renders a different tag', () => {
    const Box = createStyled('div', { componentId: 'sc-as' })`color: red;`
    render(React.createElement(Box, { as: 'section' }, 'z'))
    expect(container.querySelector('section')).not.toBeNull()
    expect(container.querySelector('div')).toBeNull()
  })

  it('does not bail: every styled render is a plain host element', () => {
    // (previously "block interpolation" would bail to styled-components)
    const Box = createStyled('div', { componentId: 'sc-nb' })`${p => (p.on ? 'background: gray;' : '')}color: red;`
    render(React.createElement(Box, { on: true }, 'q'))
    const el = container.querySelector('div')
    expect(el.className).toMatch(/^sc-nb js-[a-z0-9]+$/)
    expect(getCss()).toMatch(/background:\s*gray/)
  })
})
