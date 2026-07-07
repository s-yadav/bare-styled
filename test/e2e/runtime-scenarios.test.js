/**
 * @jest-environment jsdom
 *
 * Runtime behaviors on the new createStyled path (compiled with the decoupled
 * plugin, JSX routed through just-styled's automatic runtime — the real
 * prophecy setup). Preserves the scenarios previously covered via the removed
 * compileStatic emit: styled(Component) var forwarding (js-inline), styled
 * component used as a nested selector, and key-after-spread (createElement
 * fallback from the import-source root).
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
    presets: [
      [require.resolve('@babel/preset-react'), { runtime: 'automatic', importSource: 'just-styled', development: false }],
    ],
    plugins: [plugin, require.resolve('@babel/plugin-transform-modules-commonjs')],
  })
  const requireShim = request => {
    if (request === 'just-styled' || request === 'just-styled/runtime') return runtime
    if (request === 'just-styled/runtime/patch') return {}
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
  runtime.__resetSheet()
  document.head.innerHTML = ''
  document.body.innerHTML = ''
})

test('styled(Component) forwards a css-variable to the wrapped native node (js-inline)', () => {
  const { App } = evaluate(`
    import styled from 'styled-components'
    function Inner({ className }) { return <div id="leaf" className={className} /> }
    const Wrapped = styled(Inner)\`background: \${p => p.color};\`
    export const App = ({ color }) => <Wrapped color={color} />
  `)
  act(() => createRoot(container).render(React.createElement(App, { color: 'tomato' })))

  const leaf = container.querySelector('#leaf')
  expect(leaf.className).toMatch(/\bsc-[a-z0-9]+-\d\b/)
  expect(leaf.className).not.toContain('js-inline')
  expect(leaf.getAttribute('style')).toMatch(/--sc-[a-z0-9]+-\d-0:\s*tomato/)
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
  const childClass = child.className.match(/sc-[a-z0-9]+-\d/)[0]
  // Parent's rule targets the child by that exact class.
  expect(runtime.getCss()).toContain('.' + childClass)
  expect(runtime.getCss()).toMatch(new RegExp('\\.' + childClass + '\\{color:red;\\}'))
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
      React.createElement(List, {
        items: [
          { id: 'a', color: 'red', label: 'A' },
          { id: 'b', color: 'blue', label: 'B' },
        ],
      })
    )
  )

  const items = container.querySelectorAll('li')
  expect(items).toHaveLength(2)
  items.forEach(li => expect(li.className).toMatch(/\bsc-[a-z0-9]+-\d\b/))
  expect(items[0].getAttribute('style')).toMatch(/--sc-[a-z0-9]+-\d-0:\s*red/)
  expect(items[1].getAttribute('style')).toMatch(/--sc-[a-z0-9]+-\d-0:\s*blue/)
})
