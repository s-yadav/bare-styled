/**
 * End-to-end: transform real source with compileStatic, evaluate the output,
 * render with react-dom/server, and assert on the produced markup and CSS.
 */
import { transform } from '@babel/core'
import path from 'path'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { ServerStyleSheet } from 'styled-components'
import plugin from '../../src'
import * as runtime from 'just-styled/runtime'

const SOURCE = `
import React from 'react'
import styled from 'styled-components'

const Button = styled.button\`
  color: \${props => props.color};
  font-size: 14px;
  &:hover { opacity: 0.8; }
\`

const Title = styled.h1\`
  font-weight: 700;
\`

export const App = ({ color }) => (
  <div>
    <Title>hello</Title>
    <Button color={color} className="user-cls" style={{ margin: 1 }} variant="x">click</Button>
    <Button as="a" color="blue" href="/x">link</Button>
  </div>
)
`

// Compiles a source string through the plugin and evaluates the CJS result
// in-process, resolving just-styled/runtime to the workspace package like a
// bundler would.
const evaluate = source => {
  const { code } = transform(source, {
    filename: path.join(__dirname, 'app.jsx'),
    babelrc: false,
    configFile: false,
    presets: [[require.resolve('@babel/preset-react'), { runtime: 'classic' }]],
    plugins: [
      [plugin, { compileStatic: true }],
      require.resolve('@babel/plugin-transform-modules-commonjs'),
    ],
  })

  // Delegates to the test's own require so the compiled module shares this
  // test's react and styled-components instances (the patch must land on the
  // same react module the compiled code renders with).
  const requireShim = request => {
    if (request === 'just-styled/runtime') return runtime
    if (request === 'just-styled/runtime/patch') {
      runtime.installCreateElementPatch()
      return {}
    }
    return require(request)
  }
  const mod = { exports: {} }
  const fn = new Function('exports', 'require', 'module', code)
  fn(mod.exports, requireShim, mod)
  return mod.exports
}

afterEach(() => {
  runtime.uninstallCreateElementPatch()
  runtime.__resetSheet()
})

test('compiled components render statically with css vars and fall back on as', () => {
  const { App } = evaluate(SOURCE)
  const sheet = new ServerStyleSheet()
  let html
  try {
    html = renderToStaticMarkup(
      sheet.collectStyles(React.createElement(App, { color: 'tomato' }))
    )
  } finally {
    sheet.seal()
  }

  // static class on the h1, no styled-components involvement
  expect(html).toMatch(/<h1 class="js-[a-z0-9]+">hello<\/h1>/)

  // dynamic interpolation rendered as a css variable inline, user className and style preserved
  expect(html).toMatch(/<button[^>]*class="js-[a-z0-9]+ user-cls"/)
  expect(html).toMatch(/--sc-[a-z0-9]+-\d-\d:tomato/)
  expect(html).toContain('margin:1px')

  // non-DOM props are filtered on the static path
  expect(html).not.toContain('variant=')

  // as="a" routes through the styled-components fallback and renders an anchor
  expect(html).toMatch(/<a[^>]*href="\/x"/)

  // precompiled rules registered exactly once in the just-styled sheet
  const css = runtime.getCss()
  expect(css).toMatch(/\.js-[a-z0-9]+\{color:var\(--sc-[a-z0-9]+-\d-\d\);font-size:14px;\}/)
  expect(css).toMatch(/:hover\{opacity:0\.8;\}/)
  expect(css).toMatch(/\{font-weight:700;\}/)
})

const WRAPPER_SOURCE = `
import React from 'react'
import styled from 'styled-components'

function Wrapper({children, className}) {
  return <div id="last-native-element" className={className}>{children}</div>;
}

export const StyledWrapper = styled(Wrapper)\`
  background-color: \${props => props.color};
\`

function Inner({children, className}) {
  return <div id="last-native-element" className={className}>{children}</div>;
}

function Outer({children, className}) {
  return <Inner className={className}>{children}</Inner>;
}

export const StyledNested = styled(Outer)\`
  background-color: \${props => props.color};
\`
`

describe('styled(Component) compiles and resolves vars at the last native element', () => {
  it('lands the css var on the wrapped native div and strips the sc-inline token', () => {
    const { StyledWrapper } = evaluate(WRAPPER_SOURCE)
    const html = renderToStaticMarkup(
      React.createElement(
        StyledWrapper,
        { color: 'red' },
        React.createElement('div', null, 'Hello')
      )
    )

    const match = html.match(
      /<div id="last-native-element" class="([^"]*)" style="([^"]*)">/
    )
    expect(match).not.toBeNull()
    expect(match[1]).toMatch(/\bjs-[a-z0-9]+\b/)
    expect(match[1]).not.toContain('sc-inline')
    expect(match[2]).toMatch(/--sc-[a-z0-9]+-\d-\d:red/)
    expect(html).toContain('<div>Hello</div>')

    expect(runtime.getCss()).toMatch(
      /background-color:var\(--sc-[a-z0-9]+-\d-\d\)/
    )
  })

  it('delivers vars through two wrapper levels that forward className', () => {
    const { StyledNested } = evaluate(WRAPPER_SOURCE)
    const html = renderToStaticMarkup(
      React.createElement(StyledNested, { color: 'teal' }, 'deep')
    )

    const match = html.match(
      /<div id="last-native-element" class="([^"]*)" style="([^"]*)">/
    )
    expect(match).not.toBeNull()
    expect(match[1]).toMatch(/\bjs-[a-z0-9]+\b/)
    expect(match[1]).not.toContain('sc-inline')
    expect(match[2]).toMatch(/--sc-[a-z0-9]+-\d-\d:teal/)
  })

  it('registers no lingering sc-inline entries after the render', () => {
    const { StyledWrapper } = evaluate(WRAPPER_SOURCE)
    renderToStaticMarkup(
      React.createElement(StyledWrapper, { color: 'red' }, 'hi')
    )
    expect(runtime.__getInlineRegistrySize()).toBe(0)
  })

  it('keeps a caller-supplied className alongside the static class', () => {
    const { StyledWrapper } = evaluate(WRAPPER_SOURCE)
    const html = renderToStaticMarkup(
      React.createElement(StyledWrapper, { color: 'red', className: 'user-cls' })
    )

    const match = html.match(
      /<div id="last-native-element" class="([^"]*)"/
    )
    expect(match).not.toBeNull()
    expect(match[1]).toMatch(/\bjs-[a-z0-9]+\b/)
    expect(match[1]).toMatch(/\buser-cls\b/)
    expect(match[1]).not.toContain('sc-inline')
  })
})

const NESTED_DESCRIPTOR_SOURCE = `
import React from 'react'
import styled from 'styled-components'

function Component({ className }) {
  return <div className={className}>Hello</div>;
}

export const StyledComponent = styled(Component)\`
  color: red;
\`

export const AnotherStyledWrapper = styled(StyledComponent)\`
  background-color: \${props => props.color};
\`
`

describe('descriptor wrapping another compiled descriptor', () => {
  it('renders a single div carrying both static classes and the outer var', () => {
    const { AnotherStyledWrapper } = evaluate(NESTED_DESCRIPTOR_SOURCE)
    const html = renderToStaticMarkup(
      React.createElement(AnotherStyledWrapper, { color: 'blue' })
    )

    // Exactly one element in the output: both descriptor layers unwrap in a
    // single createElement resolution, no wrapper nodes.
    const match = html.match(/^<div class="([^"]*)" style="([^"]*)">Hello<\/div>$/)
    expect(match).not.toBeNull()
    expect(html.match(/<div/g)).toHaveLength(1)

    const classes = match[1].split(' ')
    expect(classes).toHaveLength(2)
    expect(classes[0]).toMatch(/^js-[a-z0-9]+$/)
    expect(classes[1]).toMatch(/^js-[a-z0-9]+$/)
    expect(match[1]).not.toContain('sc-inline')
    expect(match[2]).toMatch(/--sc-[a-z0-9]+-\d-\d:blue/)

    // Delete-on-read leaves nothing in the sc-inline registry.
    expect(runtime.__getInlineRegistrySize()).toBe(0)

    // Inner rule registered before outer, so the outer wins on conflicts by
    // source order.
    const css = runtime.getCss()
    const inner = css.indexOf('{color:red;}')
    const outer = css.indexOf('background-color:var(')
    expect(inner).toBeGreaterThan(-1)
    expect(outer).toBeGreaterThan(-1)
    expect(inner).toBeLessThan(outer)
  })

  it('renders as through the fallback chain and keeps the outer css', () => {
    const { AnotherStyledWrapper } = evaluate(NESTED_DESCRIPTOR_SOURCE)
    const sheet = new ServerStyleSheet()
    let html
    let styleTags
    try {
      html = renderToStaticMarkup(
        sheet.collectStyles(
          React.createElement(AnotherStyledWrapper, {
            color: 'blue',
            as: 'section',
          })
        )
      )
      styleTags = sheet.getStyleTags()
    } finally {
      sheet.seal()
    }
    expect(html).toMatch(/^<section\b/)
    expect(styleTags).toContain('background-color:blue')
  })
})

const BAILED_WRAPPER_SOURCE = `
import React from 'react'
import styled from 'styled-components'

function Component({ className }) {
  return <div className={className}>Hello</div>;
}

export const StyledComponent = styled(Component)\`
  color: red;
\`

export const ThemedWrapper = styled(StyledComponent)\`
  border-color: \${props => props.theme.main};
\`
`

describe('bailed-out styled call wrapping a compiled descriptor', () => {
  it('evaluates and renders when real styled-components wraps a descriptor at module level', () => {
    const { ThemedWrapper } = evaluate(BAILED_WRAPPER_SOURCE)
    const sheet = new ServerStyleSheet()
    let html
    let styleTags
    try {
      html = renderToStaticMarkup(
        sheet.collectStyles(
          React.createElement(ThemedWrapper, { theme: { main: 'red' } })
        )
      )
      styleTags = sheet.getStyleTags()
    } finally {
      sheet.seal()
    }
    expect(html).toContain('Hello')
    expect(styleTags).toContain('border-color:red')
  })
})

const NESTED_SELECTOR_SOURCE = `
import React from 'react'
import styled from 'styled-components'

const Child = styled.span\`
  color: green;
\`

// Interpolating a component in *selector* position bails Parent to the
// styled-components fallback. The descriptor still has to behave like a
// styled component there: \${Child} must resolve to Child's static class, and
// Child must actually render that class on its host node so the nested rule
// matches.
const Parent = styled.div\`
  \${Child} {
    color: red;
  }
\`

export const App = () => (
  <Parent>
    <Child>hi</Child>
  </Parent>
)
`

describe('a compiled descriptor is usable as a nested styled-components selector', () => {
  it('resolves ${Child} to the same static class Child renders with', () => {
    const { App } = evaluate(NESTED_SELECTOR_SOURCE)
    const scSheet = new ServerStyleSheet()
    let html
    let scStyles
    try {
      html = renderToStaticMarkup(scSheet.collectStyles(React.createElement(App)))
      scStyles = scSheet.getStyleTags()
    } finally {
      scSheet.seal()
    }

    // Child compiled to the static fast path: its host <span> carries js-<hash>.
    const childMatch = html.match(/<span class="(js-[a-z0-9]+)">hi<\/span>/)
    expect(childMatch).not.toBeNull()
    const childClass = childMatch[1]

    // Child's own rule lives in the just-styled sheet.
    expect(runtime.getCss()).toContain('.' + childClass + '{color:green;}')

    // Parent bailed to styled-components, and its nested rule targets Child by
    // that exact class — the descriptor's toString() fed styled-components the
    // right selector.
    expect(scStyles).toContain('.' + childClass)
    expect(scStyles).toMatch(new RegExp('\\.' + childClass + '\\{color:red;\\}'))
  })
})

const COMPILED_WRAPPER_OVER_BAILED_SOURCE = `
import React from 'react'
import styled from 'styled-components'

// Bails: the function interpolation returns a css string block (not a
// value-position var), so Test stays a real styled-components component.
const Test = styled.div\`
  color: red;
  \${(props) => 'background:' + props.bg + ';'}
\`

// Compiles: styled(Component) with a plain identifier. Its static color:green
// must WIN over Test's color:red — wrapper precedence.
const WrapperTest = styled(Test)\`
  color: green;
\`

export const App = () => <WrapperTest bg="blue" />
`

describe('a compiled wrapper over a bailed styled component keeps wrapper precedence', () => {
  // KNOWN LIMITATION (under design). A compiled wrapper's static rule lands in
  // the just-styled sheet at module-eval (early); the bailed inner's rule lands
  // in styled-components' sheet at render (later). Equal specificity → the later
  // (inner, red) wins, but the wrapper (green) should. Sheet reordering can't
  // fix this without breaking the opposite direction, and the earlier runtime
  // fallback fix was rejected for killing static analysis of styled(X). Kept as
  // `failing` so it documents the target and flips to green when we land a
  // proper fix; promote to `it(...)` then.
  it.failing('renders green (wrapper), not red (wrapped)', () => {
    const { App } = evaluate(COMPILED_WRAPPER_OVER_BAILED_SOURCE)
    const scSheet = new ServerStyleSheet()
    let html
    let scStyles
    try {
      html = renderToStaticMarkup(scSheet.collectStyles(React.createElement(App)))
      scStyles = scSheet.getStyleTags()
    } finally {
      scSheet.seal()
    }

    // Because Test is a real styled component, the compiled wrapper renders
    // through the real styled(Test) fallback: the rendered element carries
    // styled-components classes, NOT a lone js- class from the early sheet
    // (which would lose the cascade). (The descriptor's static rule is still
    // registered at module-eval, but it is a dead rule — nothing uses it.)
    expect(html).not.toMatch(/class="[^"]*\bjs-[a-z0-9]+/)

    // Both rules are in the styled-components sheet, and green comes AFTER red
    // (source order → wrapper wins).
    const red = scStyles.indexOf('color:red')
    const green = scStyles.indexOf('color:green')
    expect(red).toBeGreaterThan(-1)
    expect(green).toBeGreaterThan(-1)
    expect(green).toBeGreaterThan(red)

    // The bailed interpolation still applied on the wrapped component.
    expect(scStyles).toContain('background:blue')
  })
})
