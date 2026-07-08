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
import * as runtime from 'just-styled/runtime'

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
    if (request === 'just-styled/runtime') return runtime
    if (request === 'just-styled/runtime/patch') { runtime.installCreateElementPatch(); return {} }
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
  expect(el.className).toMatch(/^sc-[a-z0-9]+-0 js-[a-z0-9]+$/)
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
  expect(el.className).toMatch(/^sc-[a-z0-9]+-0 js-[a-z0-9]+$/)
  expect(el.getAttribute('style')).toBeNull() // no css variables anymore
  expect(runtime.getCss()).toMatch(/color:\s*tomato/)
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
  expect(el.className).toMatch(/^sc-[a-z0-9]+-0 js-[a-z0-9]+$/)
  expect(runtime.getCss()).toMatch(/background:\s*gray/)
  expect(el.textContent).toBe('y')
})
