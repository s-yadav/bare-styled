/** @jest-environment jsdom */
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import {
  createStyled,
  installCreateElementPatch,
  uninstallCreateElementPatch,
  getCss,
  __resetSheet,
  __getFallbackRenders,
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
      css: '.sc-pre{color:teal;}', // plugin build-time serialized rule
    })``
    render(React.createElement(Box, null, 'a'))
    expect(getCss()).toContain('.sc-pre{color:teal;}')
    __resetSheet()
    render(React.createElement(Box, null, 'b'))
    expect(getCss()).toContain('.sc-pre{color:teal;}')
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

describe('native .attrs / .withConfig (styled-components semantics)', () => {
  it('object attrs land on the host; incoming props are overridden by attrs', () => {
    const Field = createStyled('input', { componentId: 'sc-att1', attrs: [{ type: 'text' }] })`border: 1px solid #ccc;`
    render(React.createElement(Field, { type: 'password', defaultValue: 'x' }))
    const el = container.querySelector('input')
    expect(el.getAttribute('type')).toBe('text') // attrs override props (SC v5.1+ semantics)
    expect(el.className).toBe('sc-att1') // attrs don't break the static path
    expect(getCss()).toContain('.sc-att1{border:1px solid #ccc;}')
  })

  it('fn attrs receive the context and feed style interpolations', () => {
    const Sized = createStyled('div', {
      componentId: 'sc-att2',
      attrs: [p => ({ $pad: (p.$pad || 2) * 2 })],
    })`padding: ${p => p.$pad}px;`
    render(React.createElement(Sized, { $pad: 4 }, 'x'))
    expect(getCss()).toContain('padding: 8px;') // interpolation saw the attr-resolved value
  })

  it('className joins and style merges instead of overriding', () => {
    const Boxy = createStyled('div', {
      componentId: 'sc-att3',
      attrs: [{ className: 'from-attrs', style: { margin: '1px' } }],
    })`color: red;`
    render(React.createElement(Boxy, { className: 'from-props', style: { top: '2px' } }, 'x'))
    const el = container.querySelector('div')
    expect(el.className).toContain('sc-att3')
    expect(el.className).toContain('from-props')
    expect(el.className).toContain('from-attrs')
    expect(el.style.margin).toBe('1px')
    expect(el.style.top).toBe('2px')
  })

  it('chain attrs apply base-first so the extender overrides (SC folded ordering)', () => {
    const Base = createStyled('a', { componentId: 'sc-att4', attrs: [{ title: 'base', href: '#b' }] })`color: blue;`
    const Ext = createStyled(Base, { componentId: 'sc-att5', attrs: [{ title: 'ext' }] })`font-weight: 600;`
    render(React.createElement(Ext, null, 'x'))
    const el = container.querySelector('a')
    expect(el.getAttribute('title')).toBe('ext') // extender wins
    expect(el.getAttribute('href')).toBe('#b') // base attr survives
    expect(el.className).toContain('sc-att4')
    expect(el.className).toContain('sc-att5')
  })

  it('chained callback attrs see earlier attrs results in their context (SC accumulation)', () => {
    const Acc = createStyled('div', {
      componentId: 'sc-acc',
      attrs: [
        { 'data-step': 'one' },
        ctx => ({ 'data-seen': ctx['data-step'] }), // sees the object attr's result
        ctx => ({ 'data-final': ctx['data-seen'] + '-two' }), // sees the previous callback's result
      ],
    })`color: red;`
    render(React.createElement(Acc, null, 'x'))
    const el = container.querySelector('div')
    expect(el.getAttribute('data-seen')).toBe('one')
    expect(el.getAttribute('data-final')).toBe('one-two')
  })

  it('callback attrs OVERRIDE incoming props for the same key (SC v5.1+ semantics)', () => {
    const Btn = createStyled('button', {
      componentId: 'sc-fnov',
      attrs: [p => ({ type: p.$submit ? 'submit' : 'button' })],
    })`padding: 2px;`
    render(React.createElement(Btn, { type: 'reset', $submit: true }, 'x'))
    expect(container.querySelector('button').getAttribute('type')).toBe('submit')
  })

  it('a throwing callback attr (e.g. context theme access) is dropped, rest still applies', () => {
    const Risky = createStyled('div', {
      componentId: 'sc-boom',
      attrs: [
        p => ({ role: p.theme.mode }), // props.theme is undefined -> throws
        { 'data-safe': 'yes' },
      ],
    })`color: red;`
    render(React.createElement(Risky, null, 'x'))
    const el = container.querySelector('div')
    expect(el.hasAttribute('role')).toBe(false) // throwing attr dropped
    expect(el.getAttribute('data-safe')).toBe('yes') // later attr unaffected
    expect(el.className).toBe('sc-boom') // component still renders + styles
    expect(getCss()).toContain('.sc-boom{color:red;}')
  })

  it('withConfig shouldForwardProp replaces the default prop filter', () => {
    const Item = createStyled('div', {
      componentId: 'sc-sfp',
      shouldForwardProp: prop => !['disabled', 'danger'].includes(prop),
    })`color: ${p => (p.danger ? 'red' : 'black')};`
    render(React.createElement(Item, { danger: true, title: 'kept' }, 'x'))
    const el = container.querySelector('div')
    expect(el.hasAttribute('danger')).toBe(false) // filtered by the custom fn
    expect(el.getAttribute('title')).toBe('kept')
    expect(getCss()).toMatch(/color:\s*red/)
  })

  it('runtime factory is chainable: .attrs(...).withConfig(...)``', () => {
    const Btn = createStyled('button', { componentId: 'sc-will-be-overridden' })
      .attrs({ type: 'button' })
      .withConfig({ componentId: 'sc-chained' })`padding: 2px;`
    render(React.createElement(Btn, null, 'x'))
    const el = container.querySelector('button')
    expect(el.getAttribute('type')).toBe('button')
    expect(el.className).toBe('sc-chained')
    expect(getCss()).toContain('.sc-chained{padding:2px;}')
  })
})

describe('forwardRef fallback detection (fiber-win diagnostics)', () => {
  it('unintercepted render pays a fiber: counter increments and warns once per component', () => {
    uninstallCreateElementPatch() // simulate a missed interception
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const Box = createStyled('div', { componentId: 'sc-fb', displayName: 'FbBox' })`color: red;`
      const before = __getFallbackRenders()
      // Raw, unpatched createElement: the descriptor reaches React as a TYPE,
      // so the forwardRef body must run (wrapper fiber) — for both instances.
      render(React.createElement('div', null, React.createElement(Box, { key: 1 }), React.createElement(Box, { key: 2 })))
      expect(container.querySelectorAll('.sc-fb')).toHaveLength(2) // still renders correctly
      expect(__getFallbackRenders()).toBe(before + 2) // each fallback render counted
      const ours = warn.mock.calls.filter(c => String(c[0]).includes('[just-styled]'))
      expect(ours).toHaveLength(1) // warned once per component, not per render
      expect(String(ours[0][0])).toContain('FbBox')
    } finally {
      warn.mockRestore()
    }
  })

  it('intercepted render pays nothing: counter unchanged with the patch installed', () => {
    // beforeEach installed the patch
    const Box = createStyled('div', { componentId: 'sc-nofb' })`color: blue;`
    const before = __getFallbackRenders()
    render(React.createElement(Box, null, 'x'))
    expect(container.querySelector('.sc-nofb')).not.toBeNull()
    expect(__getFallbackRenders()).toBe(before) // resolved at creation — no fiber
  })
})
