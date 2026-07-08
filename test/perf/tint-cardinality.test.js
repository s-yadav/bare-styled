/**
 * @jest-environment jsdom
 *
 * Confirms the pivot: just-styled now generates a distinct HASH CLASS per
 * distinct resolved style (styled-components' model), not a CSS variable per
 * element. So both libraries track cardinality identically — few distinct
 * values -> few classes; unique-per-cell -> a class per cell — and just-styled
 * puts NO inline style/var on the cells.
 */
import { transform } from '@babel/core'
import { readFileSync } from 'fs'
import path from 'path'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import plugin from '../../src/js-transform'
import * as runtime from 'just-styled/runtime'

const widgetSrc = readFileSync(path.join(__dirname, '../../profiling/widget/widget.jsx'), 'utf8')
global.IS_REACT_ACT_ENVIRONMENT = true

function build(useJustStyled) {
  const plugins = [require.resolve('@babel/plugin-transform-modules-commonjs')]
  if (useJustStyled) plugins.unshift(plugin)
  const { code } = transform(widgetSrc, {
    filename: path.join(__dirname, 'widget.jsx'), babelrc: false, configFile: false,
    presets: [[require.resolve('@babel/preset-react'), { runtime: 'automatic', importSource: useJustStyled ? 'just-styled' : 'react', development: false }]],
    plugins,
  })
  const requireShim = request => {
    if (request === 'just-styled/runtime') return runtime
    if (request === 'just-styled/runtime/patch') { runtime.installCreateElementPatch(); return {} }
    return require(request)
  }
  const mod = { exports: {} }
  new Function('exports', 'require', 'module', code)(mod.exports, requireShim, mod)
  return mod.exports.Widget
}

const ROWS = 20, COLS = 10

function stats(Widget, tintMode) {
  const rows = Array.from({ length: ROWS }, (_, i) => i)
  const cols = Array.from({ length: COLS }, (_, i) => i)
  const container = document.createElement('div'); document.body.appendChild(container)
  const root = createRoot(container)
  act(() => root.render(React.createElement(Widget, { rows, cols, tick: 0, tintMode })))
  const tds = [...container.querySelectorAll('td')]
  const out = {
    tdCount: tds.length,
    distinctClasses: new Set(tds.map(td => td.getAttribute('class') || '')).size,
    distinctStyles: new Set(tds.map(td => td.getAttribute('style') || '')).size,
  }
  act(() => root.unmount()); container.remove()
  return out
}

afterEach(() => { runtime.uninstallCreateElementPatch(); runtime.__resetSheet() })

test('styled-components: cardinality tracked by generated classes', () => {
  const SC = build(false)
  expect(stats(SC, 'few').distinctClasses).toBeLessThanOrEqual(3)
  expect(stats(SC, 'unique').distinctClasses).toBeGreaterThan(ROWS * COLS * 0.8)
})

test('just-styled: same class-based cardinality, and NO inline var/style on cells', () => {
  const JS = build(true)
  const few = stats(JS, 'few')
  const uniq = stats(JS, 'unique')
  // hash classes now, like styled-components:
  expect(few.distinctClasses).toBeLessThanOrEqual(3)
  expect(uniq.distinctClasses).toBeGreaterThan(ROWS * COLS * 0.8)
  // and no per-cell inline styles (the css-variable approach is gone):
  expect(few.distinctStyles).toBeLessThanOrEqual(1)
  expect(uniq.distinctStyles).toBeLessThanOrEqual(1)
})
