/**
 * @jest-environment jsdom
 *
 * Runtime scenarios on the hash-class model, compiled with the plugin and JSX
 * routed through bare-styled's automatic runtime (the real prophecy setup):
 * styled(Component) class forwarding, styled component used as a nested selector,
 * and key-after-spread (createElement fallback from the import-source root).
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
    presets: [[require.resolve('@babel/preset-react'), { runtime: 'automatic', importSource: 'bare-styled', development: false }]],
    plugins: [plugin, require.resolve('@babel/plugin-transform-modules-commonjs')],
  })
  const requireShim = request => {
    if (request === 'bare-styled' || request === 'bare-styled/runtime') return runtime
    if (request === 'bare-styled/runtime/patch') return {}
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
afterEach(() => { runtime.__resetSheet(); document.head.innerHTML = ''; document.body.innerHTML = '' })

test('styled(Component) forwards its class to the wrapped native node', () => {
  const { App } = evaluate(`
    import styled from 'styled-components'
    function Inner({ className }) { return <div id="leaf" className={className} /> }
    const Wrapped = styled(Inner)\`background: \${p => p.color};\`
    export const App = ({ color }) => <Wrapped color={color} />
  `)
  act(() => createRoot(container).render(React.createElement(App, { color: 'tomato' })))
  const leaf = container.querySelector('#leaf')
  expect(leaf.className).toMatch(/^sc-[a-z0-9]+-\d bs-[a-z0-9]+$/)
  expect(runtime.getCss()).toMatch(/background:\s*tomato/)
})

test('a styled component resolves as a nested selector in another component', () => {
  const { App } = evaluate(`
    import styled from 'styled-components'
    const Child = styled.span\`color: green;\`
    const Parent = styled.div\`\${Child} { color: red; }\`
    export const App = () => <Parent><Child>hi</Child></Parent>
  `)
  act(() => createRoot(container).render(React.createElement(App)))
  const child = container.querySelector('span')
  // Child's stable componentId is the selector target Parent's rule references.
  const childId = child.className.split(' ')[0]
  expect(childId).toMatch(/^sc-[a-z0-9]+-\d$/)
  expect(runtime.getCss()).toContain('.' + childId + '{color:red;}')
})

test('key-after-spread in a map resolves via the root createElement fallback', () => {
  const { List } = evaluate(`
    import styled from 'styled-components'
    const Item = styled.li\`color: \${p => p.color};\`
    export const List = ({ items }) => (
      <ul>{items.map(it => <Item {...it} color={it.color} key={it.id}>{it.label}</Item>)}</ul>
    )
  `)
  act(() =>
    createRoot(container).render(
      React.createElement(List, { items: [{ id: 'a', color: 'red', label: 'A' }, { id: 'b', color: 'blue', label: 'B' }] })
    )
  )
  const items = container.querySelectorAll('li')
  expect(items).toHaveLength(2)
  items.forEach(li => expect(li.className).toMatch(/^sc-[a-z0-9]+-\d bs-[a-z0-9]+$/))
  // distinct colors -> distinct hash classes
  expect(items[0].className.split(' ')[1]).not.toBe(items[1].className.split(' ')[1])
})
