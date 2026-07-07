/**
 * @jest-environment jsdom
 *
 * Full pipeline: transform real source with the decoupled plugin, evaluate the
 * output, and render it into a real DOM. Proves compile (createStyled emit) +
 * runtime (first-render flatten) work end to end.
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
    if (request === 'just-styled/runtime/patch') {
      runtime.installCreateElementPatch()
      return {}
    }
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

test('static + shared fragment + module theme -> one rule, host element, no var', () => {
  const { App } = evaluate(`
    import React from 'react'
    import styled, { css } from 'styled-components'
    const theme = { bg: '#eee' }
    const shared = css\`color: red; background-color: \${theme.bg};\`
    const Card = styled.div\`width: 400px; \${shared}\`
    export const App = () => <Card>hi</Card>
  `)
  act(() => createRoot(container).render(React.createElement(App)))

  const el = container.querySelector('div')
  expect(el.className).toMatch(/\bsc-[a-z0-9]+-0\b/)
  expect(el.getAttribute('style')).toBeNull()
  expect(runtime.getCss()).toMatch(/width:\s*400px/)
  expect(runtime.getCss()).toMatch(/background-color:\s*#eee/)
})

test('value-position function -> css variable on the host element', () => {
  const { App } = evaluate(`
    import React from 'react'
    import styled from 'styled-components'
    const Button = styled.button\`color: \${p => p.color}; font-size: 14px;\`
    export const App = ({ color }) => <Button color={color}>x</Button>
  `)
  act(() => createRoot(container).render(React.createElement(App, { color: 'tomato' })))

  const el = container.querySelector('button')
  expect(el.className).toMatch(/\bsc-[a-z0-9]+-0\b/)
  expect(el.getAttribute('style')).toMatch(/--sc-[a-z0-9]+-0-0:\s*tomato/)
})

test('block/conditional function -> bails and renders via styled-components', () => {
  const { App } = evaluate(`
    import React from 'react'
    import styled from 'styled-components'
    const Box = styled.div\`\${p => p.on && 'background: gray;'}\`
    export const App = () => <Box>y</Box>
  `)
  act(() => createRoot(container).render(React.createElement(App)))

  expect(container.querySelector('div')).not.toBeNull()
  expect(container.textContent).toBe('y')
})
