/**
 * @jest-environment jsdom
 *
 * End-to-end with a real client render (react-dom/client into a jsdom DOM),
 * exercising the automatic JSX runtime pointed at `just-styled` — the same
 * path a Vite/oxc app uses via `jsxImportSource: 'just-styled'`. Asserts the
 * mounted DOM element actually carries the static `js-` class and the inline
 * CSS variable, with no styled-components wrapper node in the tree.
 */
import { transform } from '@babel/core'
import path from 'path'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import * as runtime from 'just-styled/runtime'

// react-dom/client requires this flag to be set for act().
global.IS_REACT_ACT_ENVIRONMENT = true

const SOURCE = `
import styled from 'styled-components'

const Button = styled.button\`
  color: \${props => props.color};
  font-size: 14px;
\`

const Card = styled.div\`
  padding: 8px;
\`

export const App = ({ color }) => (
  <Card>
    <Button color={color} className="user-cls" variant="ignored">click</Button>
  </Card>
)
`

// Compile with the automatic runtime pointed at just-styled, exactly like the
// Vite integration (jsxImportSource), then run the CJS output in-process.
const evaluate = source => {
  const { code } = transform(source, {
    filename: path.join(__dirname, 'app.jsx'),
    babelrc: false,
    configFile: false,
    presets: [
      [
        require.resolve('@babel/preset-react'),
        { runtime: 'automatic', importSource: 'just-styled', development: false },
      ],
    ],
    plugins: [
      [require('../../src'), { compileStatic: true }],
      require.resolve('@babel/plugin-transform-modules-commonjs'),
    ],
  })

  const requireShim = request => {
    // Share this test's runtime instance so the descriptor and the jsx-runtime
    // wrapper agree on the inline registry and react module. `just-styled`
    // (the import-source root) and `just-styled/runtime` are the same module.
    if (request === 'just-styled' || request === 'just-styled/runtime') return runtime
    if (request === 'just-styled/runtime/patch') return {}
    return require(request)
  }
  const mod = { exports: {} }
  new Function('exports', 'require', 'module', code)(mod.exports, requireShim, mod)
  return mod.exports
}

afterEach(() => {
  runtime.__resetSheet()
  document.head.innerHTML = ''
  document.body.innerHTML = ''
})

test('a compiled component mounts with the js- class and inline css var, no wrapper', () => {
  const { App } = evaluate(SOURCE)
  const container = document.createElement('div')
  document.body.appendChild(container)

  let root
  act(() => {
    root = createRoot(container)
    root.render(React.createElement(App, { color: 'tomato' }))
  })

  const button = container.querySelector('button')
  const card = container.querySelector('div')

  // The static class is present on the real DOM node.
  expect(button).not.toBeNull()
  expect(button.className).toMatch(/\bjs-[a-z0-9]+\b/)
  expect(button.className).toContain('user-cls')

  // Dynamic interpolation landed as an inline css variable.
  expect(button.getAttribute('style')).toMatch(/--sc-[a-z0-9]+-\d-\d:\s*tomato/)

  // Non-DOM prop was filtered off the static path.
  expect(button.hasAttribute('variant')).toBe(false)

  // The static-only parent also compiled to a plain div with a js- class.
  expect(card.className).toMatch(/\bjs-[a-z0-9]+\b/)

  // No styled-components wrapper: exactly one button, one div, and the button
  // is a direct child of the card (descriptors flatten to host elements).
  expect(container.querySelectorAll('button')).toHaveLength(1)
  expect(button.parentElement).toBe(card)
  expect(button.textContent).toBe('click')

  // The precompiled rules were injected into the just-styled <style> tag at
  // module-eval time (asset load), not during render.
  const styleTag = document.head.querySelector('style[data-just-styled]')
  expect(styleTag).not.toBeNull()
  expect(styleTag.textContent).toMatch(/\.js-[a-z0-9]+\{color:var\(/)
  expect(styleTag.textContent).toContain('padding:8px')

  act(() => root.unmount())
})

test('updating a prop updates the inline css variable in place (no remount)', () => {
  const { App } = evaluate(SOURCE)
  const container = document.createElement('div')
  document.body.appendChild(container)

  let root
  act(() => {
    root = createRoot(container)
    root.render(React.createElement(App, { color: 'tomato' }))
  })
  const first = container.querySelector('button')

  act(() => root.render(React.createElement(App, { color: 'rebeccapurple' })))
  const second = container.querySelector('button')

  // Same DOM node reused (reconciled in place), only the variable changed.
  expect(second).toBe(first)
  expect(second.getAttribute('style')).toMatch(/--sc-[a-z0-9]+-\d-\d:\s*rebeccapurple/)

  act(() => root.unmount())
})

// key-after-spread forces the automatic runtime onto the `createElement`
// fallback, imported from the import-source ROOT (`just-styled`) — the case
// that produced "_createElement is not a function" when the root didn't export
// one. A styled item inside a `.map` exercises exactly that path.
const LIST_SOURCE = `
import styled from 'styled-components'

const Item = styled.li\`
  color: \${props => props.color};
\`

export const List = ({ items }) => (
  <ul>
    {items.map(it => (
      <Item {...it} color={it.color} key={it.id}>{it.label}</Item>
    ))}
  </ul>
)
`

test('key-after-spread in a map (createElement fallback) resolves to js- host elements', () => {
  const { List } = evaluate(LIST_SOURCE)
  const container = document.createElement('div')
  document.body.appendChild(container)

  act(() => {
    createRoot(container).render(
      React.createElement(List, {
        items: [
          { id: 'a', color: 'red', label: 'A' },
          { id: 'b', color: 'blue', label: 'B' },
        ],
      })
    )
  })

  const items = container.querySelectorAll('li')
  expect(items).toHaveLength(2)
  items.forEach(li => expect(li.className).toMatch(/\bjs-[a-z0-9]+\b/))
  expect(items[0].getAttribute('style')).toMatch(/--sc-[a-z0-9]+-\d-\d:\s*red/)
  expect(items[1].getAttribute('style')).toMatch(/--sc-[a-z0-9]+-\d-\d:\s*blue/)
  // No spread-through of the `id` prop onto the DOM (non-DOM props filtered).
  expect(items[0].textContent).toBe('A')
})
