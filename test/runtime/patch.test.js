import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import styled, { ServerStyleSheet } from 'styled-components'
import {
  createStyledElement,
  installCreateElementPatch,
  uninstallCreateElementPatch,
  __resetSheet,
  __getInlineRegistrySize,
} from 'just-styled/runtime'

const makeDesc = overrides =>
  createStyledElement({
    component: 'button',
    className: 'js-btn',
    css: '.js-btn{color:var(--sc-x-0);}',
    vars: [['--sc-x-0', props => props.variant]],
    componentId: 'sc-x',
    fallback: () => styled.button`color: red;`,
    ...overrides,
  })

beforeEach(() => {
  __resetSheet()
})

describe('createElement patch rendering', () => {
  beforeAll(() => {
    installCreateElementPatch()
  })

  afterAll(() => {
    uninstallCreateElementPatch()
  })

  it('renders a native tag with static className and css vars as inline style', () => {
    const Button = makeDesc()
    const html = renderToStaticMarkup(
      React.createElement(Button, { variant: 'red' }, 'hi')
    )
    expect(html).toBe('<button class="js-btn" style="--sc-x-0:red">hi</button>')
  })

  it('renders without props and skips vars that yield undefined', () => {
    const Button = makeDesc()
    const html = renderToStaticMarkup(React.createElement(Button))
    expect(html).toBe('<button class="js-btn"></button>')
  })

  it('merges user className after the static one and lets user style win', () => {
    const Button = makeDesc()
    const html = renderToStaticMarkup(
      React.createElement(Button, {
        variant: 'red',
        className: 'user',
        style: { '--sc-x-0': 'blue', color: 'green' },
      })
    )
    expect(html).toContain('class="js-btn user"')
    expect(html).toMatch(/--sc-x-0:\s*blue/)
    expect(html).toMatch(/color:\s*green/)
  })

  it('keeps numeric var values', () => {
    const Box = makeDesc({
      component: 'div',
      className: 'js-box',
      css: '.js-box{opacity:var(--sc-y-0);}',
      vars: [['--sc-y-0', props => props.level]],
    })
    const html = renderToStaticMarkup(React.createElement(Box, { level: 0.5 }))
    expect(html).toMatch(/--sc-y-0:\s*0\.5/)
  })

  it('filters non-DOM props but keeps valid, data- and aria- attributes', () => {
    const Link = makeDesc({ component: 'a', className: 'js-link' })
    const html = renderToStaticMarkup(
      React.createElement(
        Link,
        {
          primary: 'yes',
          href: '/docs',
          'data-test': 'link',
          'aria-label': 'Docs',
        },
        'docs'
      )
    )
    expect(html).toContain('href="/docs"')
    expect(html).toContain('data-test="link"')
    expect(html).toContain('aria-label="Docs"')
    expect(html).not.toContain('primary')
  })

  it('routes the as prop through the styled-components fallback', () => {
    const Button = makeDesc()
    const sheet = new ServerStyleSheet()
    let html
    try {
      html = renderToStaticMarkup(
        sheet.collectStyles(
          React.createElement(Button, { as: 'a', href: '/x' }, 'go')
        )
      )
    } finally {
      sheet.seal()
    }
    expect(html).toMatch(/^<a\b/)
    expect(html).toContain('href="/x"')
    expect(html).toContain('go')
    expect(html).not.toContain('js-btn')
  })

  it('routes the theme prop through the styled-components fallback', () => {
    const Button = makeDesc({
      fallback: () => styled.button`
        color: ${props => props.theme.main};
      `,
    })
    const sheet = new ServerStyleSheet()
    let html
    try {
      html = renderToStaticMarkup(
        sheet.collectStyles(
          React.createElement(Button, { theme: { main: 'blue' } }, 'themed')
        )
      )
    } finally {
      sheet.seal()
    }
    expect(html).toMatch(/^<button\b/)
    expect(html).toContain('themed')
    expect(html).not.toContain('js-btn')
  })

  it('memoizes the fallback across renders', () => {
    const fallback = jest.fn(() => styled.button`color: red;`)
    const Button = makeDesc({ fallback })
    const sheet = new ServerStyleSheet()
    try {
      renderToStaticMarkup(
        sheet.collectStyles(React.createElement(Button, { as: 'a' }))
      )
      renderToStaticMarkup(
        sheet.collectStyles(React.createElement(Button, { as: 'span' }))
      )
    } finally {
      sheet.seal()
    }
    expect(fallback).toHaveBeenCalledTimes(1)
  })

  it('works through the automatic jsx runtime', () => {
    const { jsx } = require('react/jsx-runtime')
    const Button = makeDesc()
    const html = renderToStaticMarkup(
      jsx(Button, { variant: 'teal', children: 'hi' })
    )
    expect(html).toBe(
      '<button class="js-btn" style="--sc-x-0:teal">hi</button>'
    )
  })

  describe('descriptors as styled-components targets', () => {
    it('lets real styled-components wrap a descriptor and applies both layers', () => {
      const Button = makeDesc()
      const Padded = styled(Button)`
        padding: 3px;
      `
      const sheet = new ServerStyleSheet()
      let html
      let styleTags
      try {
        html = renderToStaticMarkup(
          sheet.collectStyles(
            React.createElement(Padded, { variant: 'red' }, 'hi')
          )
        )
        styleTags = sheet.getStyleTags()
      } finally {
        sheet.seal()
      }
      expect(html).toMatch(/^<button\b/)
      expect(html).toContain('js-btn')
      expect(html).toContain('hi')
      expect(styleTags).toContain('padding:3px')
    })

    it('renders as on a descriptor wrapping another descriptor via the fallback', () => {
      const Base = makeDesc()
      const Fancy = createStyledElement({
        component: Base,
        className: 'js-fancy',
        css: '.js-fancy{padding:var(--sc-f-0);}',
        vars: [['--sc-f-0', props => props.pad]],
        componentId: 'sc-f',
        fallback: () =>
          styled(Base)`
            padding: 3px;
          `,
      })
      const sheet = new ServerStyleSheet()
      let html
      let styleTags
      try {
        html = renderToStaticMarkup(
          sheet.collectStyles(
            React.createElement(Fancy, { as: 'section' }, 'x')
          )
        )
        styleTags = sheet.getStyleTags()
      } finally {
        sheet.seal()
      }
      expect(html).toMatch(/^<section\b/)
      expect(html).toContain('x')
      expect(styleTags).toContain('padding:3px')
    })
  })

  describe('js-inline forwarding for component refs', () => {
    const Wrapper = props => React.createElement('div', props)

    it('delivers vars to the native node and strips the token', () => {
      const Styled = makeDesc({
        component: Wrapper,
        className: 'js-wrap',
        css: '.js-wrap{width:var(--sc-w-0);}',
        vars: [['--sc-w-0', props => props.size]],
      })
      const html = renderToStaticMarkup(
        React.createElement(Styled, { size: 42 })
      )
      expect(html).toContain('class="js-wrap"')
      expect(html).not.toContain('js-inline')
      expect(html).toMatch(/--sc-w-0:\s*42/)
    })

    it('keeps the user className and lets the native node style win', () => {
      const OwnStyle = props =>
        React.createElement('div', { ...props, style: { '--sc-w-0': 'own' } })
      const Styled = makeDesc({
        component: OwnStyle,
        className: 'js-wrap',
        css: '.js-wrap{width:var(--sc-w-0);}',
        vars: [['--sc-w-0', props => props.size]],
      })
      const html = renderToStaticMarkup(
        React.createElement(Styled, { size: 42, className: 'user' })
      )
      expect(html).toContain('class="js-wrap user"')
      expect(html).not.toContain('js-inline')
      expect(html).toMatch(/--sc-w-0:\s*own/)
      expect(html).not.toMatch(/--sc-w-0:\s*42/)
    })

    it('leaves an unregistered js-inline token in place when no forwarding is active', () => {
      // Hot-path contract: when the inline registry is empty (no descriptor
      // forwarded a token this pass) the patch skips the per-element className
      // scan entirely. A stray js-inline token a user authored by hand is left
      // untouched — but it is inert, since no rule ever targets it. Tokens the
      // runtime actually forwards are stripped on the slow path (the registry
      // is non-empty at that point); see the component-ref tests above.
      const html = renderToStaticMarkup(
        React.createElement('div', { className: 'a js-inline-999999 b' })
      )
      expect(html).toBe('<div class="a js-inline-999999 b"></div>')
    })

    it('forwards a plain className when the descriptor has no vars', () => {
      let received
      const Spy = props => {
        received = props.className
        return React.createElement('div', props)
      }
      const Styled = makeDesc({
        component: Spy,
        className: 'js-static',
        css: '.js-static{color:red;}',
        vars: undefined,
      })
      const html = renderToStaticMarkup(React.createElement(Styled))
      expect(received).toBe('js-static')
      expect(html).toBe('<div class="js-static"></div>')
    })

    it('registers exactly one inline entry for a var-carrying component ref and consumes it', () => {
      const sizeBefore = __getInlineRegistrySize()
      let sizeDuringRender
      const Spy = props => {
        sizeDuringRender = __getInlineRegistrySize()
        return React.createElement('div', props)
      }
      const Styled = makeDesc({
        component: Spy,
        className: 'js-wrap',
        css: '.js-wrap{width:var(--sc-w-0);}',
        vars: [['--sc-w-0', props => props.size]],
      })
      const html = renderToStaticMarkup(
        React.createElement(Styled, { size: 42 })
      )
      expect(sizeDuringRender).toBe(sizeBefore + 1)
      expect(__getInlineRegistrySize()).toBe(sizeBefore)
      // The registry entry is what landed on the native node: its contents
      // are exactly getInlineStyles(props).
      expect(Styled.getInlineStyles({ size: 42 })).toEqual({ '--sc-w-0': 42 })
      expect(html).toMatch(/--sc-w-0:\s*42/)
    })

    it('resolves a descriptor whose component ref is another descriptor', () => {
      const Base = makeDesc({
        component: 'div',
        className: 'js-base',
        css: '.js-base{color:var(--sc-b-0);}',
        vars: [['--sc-b-0', props => props.tint]],
      })
      const Fancy = makeDesc({
        component: Base,
        className: 'js-fancy',
        css: '.js-fancy{width:var(--sc-f-0);}',
        vars: [['--sc-f-0', props => props.size]],
      })
      const html = renderToStaticMarkup(
        React.createElement(Fancy, { tint: 'red', size: 42 }, 'hi')
      )
      expect(html).toContain('class="js-base js-fancy"')
      expect(html).not.toContain('js-inline')
      expect(html).toMatch(/--sc-b-0:\s*red/)
      expect(html).toMatch(/--sc-f-0:\s*42/)
    })
  })
})

describe('descriptor rendering without the patch', () => {
  it('renders through the styled-components fallback when the patch is not installed', () => {
    const Button = makeDesc()
    const sheet = new ServerStyleSheet()
    let html
    let styleTags
    try {
      html = renderToStaticMarkup(
        sheet.collectStyles(
          React.createElement(Button, { variant: 'red' }, 'hi')
        )
      )
      styleTags = sheet.getStyleTags()
    } finally {
      sheet.seal()
    }
    expect(html).toMatch(/^<button\b/)
    expect(html).toContain('hi')
    expect(styleTags).toContain('color:red')
  })
})

describe('patch lifecycle', () => {
  const originalCreateElement = React.createElement
  const jsxRuntime = require('react/jsx-runtime')
  const originalJsx = jsxRuntime.jsx

  afterEach(() => {
    uninstallCreateElementPatch()
  })

  it('is idempotent and uninstall restores the originals', () => {
    installCreateElementPatch()
    const patched = React.createElement
    expect(patched).not.toBe(originalCreateElement)
    installCreateElementPatch()
    expect(React.createElement).toBe(patched)
    expect(jsxRuntime.jsx).not.toBe(originalJsx)

    uninstallCreateElementPatch()
    expect(React.createElement).toBe(originalCreateElement)
    expect(jsxRuntime.jsx).toBe(originalJsx)
  })

  it('descriptors pass through untouched when the patch is not installed', () => {
    const Button = makeDesc()
    const element = originalCreateElement(Button, { color: 'red' })
    expect(element.type).toBe(Button)
  })
})
