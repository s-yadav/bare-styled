/**
 * @jest-environment jsdom
 *
 * Full pipeline: compile source with the plugin (styled -> createStyled) and
 * render into a real DOM. Hash-class model — every styled element resolves to a
 * host element with `componentId + js-<hash>` classes; no CSS vars, no bail.
 */
import { transform } from '@babel/core'
import path from 'path'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import plugin from '../../src/js-transform'
import * as runtime from 'bare-styled/runtime'

global.IS_REACT_ACT_ENVIRONMENT = true

const evaluate = source => {
  const { code } = transform(source, {
    filename: path.join(__dirname, 'app.jsx'),
    babelrc: false,
    configFile: false,
    presets: [[require.resolve('@babel/preset-react'), { runtime: 'classic' }]],
    plugins: [plugin, require.resolve('@babel/plugin-transform-modules-commonjs')],
  })
  const requireShim = request => {
    if (request === 'bare-styled/runtime') return runtime
    if (request === 'bare-styled/runtime/patch') { runtime.installCreateElementPatch(); return {} }
    return require(request)
  }
  const mod = { exports: {} }
  new Function('exports', 'require', 'module', code)(mod.exports, requireShim, mod)
  return mod.exports
}

let container
beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
})
afterEach(() => {
  runtime.uninstallCreateElementPatch()
  runtime.__resetSheet()
  document.head.innerHTML = ''
  document.body.innerHTML = ''
})

test('static + shared fragment + module value resolve into one hash-class rule', () => {
  const { App } = evaluate(`
    import React from 'react'
    import styled, { css } from 'styled-components'
    const t = { bg: '#eee' }
    const shared = css\`color: red; background-color: \${t.bg};\`
    const Card = styled.div\`width: 400px; \${shared}\`
    export const App = () => <Card>hi</Card>
  `)
  act(() => createRoot(container).render(React.createElement(App)))
  const el = container.querySelector('div')
  // module value + fragment resolve to a constant css -> STATIC -> componentId only.
  expect(el.className).toMatch(/^sc-[a-z0-9]+-0$/)
  expect(runtime.getCss()).toMatch(/width:\s*400px/)
  expect(runtime.getCss()).toMatch(/background-color:\s*#eee/)
})

test('prop-dependent styles produce a hash-class carrying the resolved value', () => {
  const { App } = evaluate(`
    import React from 'react'
    import styled from 'styled-components'
    const Button = styled.button\`color: \${p => p.color}; font-size: 14px;\`
    export const App = ({ color }) => <Button color={color}>x</Button>
  `)
  act(() => createRoot(container).render(React.createElement(App, { color: 'tomato' })))
  const el = container.querySelector('button')
  expect(el.className).toMatch(/^sc-[a-z0-9]+-0 bs-[a-z0-9]+$/)
  expect(el.getAttribute('style')).toBeNull() // no css variables anymore
  expect(runtime.getCss()).toMatch(/color:\s*tomato/)
})

test('static-after-flatten (module const member) is pre-compiled at build time', () => {
  const { App } = evaluate(`
    import React from 'react'
    import styled from 'styled-components'
    const theme = { border: '#e5e7eb' }
    const Box = styled.div\`border: 1px solid \${theme.border}; padding: 8px;\`
    export const App = () => <Box>hi</Box>
  `)
  act(() => createRoot(container).render(React.createElement(App)))
  const el = container.querySelector('div')
  // fully static after resolving the constant -> componentId only, no hash
  expect(el.className).toMatch(/^sc-[a-z0-9]+-0$/)
  // the plugin emptied the template, so the rule can only be present because the
  // constant was resolved and baked into the build-time static body.
  const css = runtime.getCss()
  expect(css).toMatch(/border:\s*1px solid #e5e7eb/)
  expect(css).toMatch(/padding:\s*8px/)
})

test('styled(StyledComponent) through the plugin: separate rules, extender wins by order', () => {
  const { App } = evaluate(`
    import React from 'react'
    import styled from 'styled-components'
    const Button = styled.button\`padding: 6px 12px; color: black;\`
    const IconButton = styled(Button)\`padding: 4px 8px;\`
    export const App = () => <IconButton>x</IconButton>
  `)
  act(() => createRoot(container).render(React.createElement(App)))
  const el = container.querySelector('button')
  expect(el).not.toBeNull()
  const classes = el.className.split(' ')
  expect(classes.length).toBe(2) // base id + extender id, both on the element
  const css = runtime.getCss()
  // two separate rules; the base's is inserted before the extender's -> extender wins
  const baseId = classes.find(c => css.indexOf('.' + c + '{') < css.indexOf('.' + classes.find(x => x !== c) + '{')) || classes[0]
  const extId = classes.find(c => c !== baseId)
  expect(css.match(new RegExp('\\.' + baseId + '\\{([^}]*)\\}'))[1]).toContain('padding:6px 12px')
  expect(css.match(new RegExp('\\.' + extId + '\\{([^}]*)\\}'))[1]).toContain('padding:4px 8px')
  expect(css.indexOf('.' + baseId + '{')).toBeLessThan(css.indexOf('.' + extId + '{'))
})

test('conditional/block interpolation no longer bails — resolves inline', () => {
  const { App } = evaluate(`
    import React from 'react'
    import styled from 'styled-components'
    const Box = styled.div\`\${p => p.on && 'background: gray;'} color: red;\`
    export const App = ({ on }) => <Box on={on}>y</Box>
  `)
  act(() => createRoot(container).render(React.createElement(App, { on: true })))
  const el = container.querySelector('div')
  expect(el.className).toMatch(/^sc-[a-z0-9]+-0 bs-[a-z0-9]+$/)
  expect(runtime.getCss()).toMatch(/background:\s*gray/)
  expect(el.textContent).toBe('y')
})
