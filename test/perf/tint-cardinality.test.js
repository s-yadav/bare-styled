/**
 * @jest-environment jsdom
 *
 * Confirms what each model emits per cell in the widget harness' tint modes:
 * how many DISTINCT <td> class names (styled-components' dynamic classes) vs how
 * many distinct inline --var values (just-styled). Verifies `unique` really is
 * high-cardinality for styled-components.
 */
import { transform } from '@babel/core'
import { readFileSync } from 'fs'
import path from 'path'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import plugin from '../../src/js-transform'
import * as runtime from 'just-styled/runtime'

const widgetSrc = readFileSync(path.join(__dirname, '../../profiling/widget/widget.jsx'), 'utf8')

function build(useJustStyled) {
  const plugins = [require.resolve('@babel/plugin-transform-modules-commonjs')]
  if (useJustStyled) plugins.unshift(plugin)
  const { code } = transform(widgetSrc, {
    filename: path.join(__dirname, 'widget.jsx'),
    babelrc: false, configFile: false,
    presets: [[require.resolve('@babel/preset-react'), {
      runtime: 'automatic',
      importSource: useJustStyled ? 'just-styled' : 'react',
      development: false,
    }]],
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

const ROWS = 20, COLS = 10 // 200 cells
global.IS_REACT_ACT_ENVIRONMENT = true

function stats(Widget, tintMode) {
  const rows = Array.from({ length: ROWS }, (_, i) => i)
  const cols = Array.from({ length: COLS }, (_, i) => i)
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => root.render(React.createElement(Widget, { rows, cols, tick: 0, tintMode })))
  const tds = [...container.querySelectorAll('td')]
  const classes = tds.map(td => td.getAttribute('class') || '')
  const styles = tds.map(td => td.getAttribute('style') || '')
  const out = {
    tdCount: tds.length,
    distinctClasses: new Set(classes).size,
    distinctStyles: new Set(styles).size,
  }
  act(() => root.unmount())
  container.remove()
  return out
}

afterEach(() => { runtime.uninstallCreateElementPatch(); runtime.__resetSheet() })

test('styled-components: `unique` tint really explodes classes; `few` does not', () => {
  const SC = build(false)
  const few = stats(SC, 'few')
  const uniq = stats(SC, 'unique')
  // eslint-disable-next-line no-console
  console.log('\nstyled-components  cells=%d  few: %d distinct td classes | unique: %d distinct td classes',
    few.tdCount, few.distinctClasses, uniq.distinctClasses)
  expect(few.tdCount).toBe(ROWS * COLS)
  expect(few.distinctClasses).toBeLessThanOrEqual(3)         // ~1-2 cached classes
  expect(uniq.distinctClasses).toBeGreaterThan(ROWS * COLS * 0.8) // ~one class per cell
})

test('just-styled: one static class per cell, dynamics via distinct inline vars', () => {
  const JS = build(true)
  const few = stats(JS, 'few')
  const uniq = stats(JS, 'unique')
  // eslint-disable-next-line no-console
  console.log('just-styled       cells=%d  few: %d distinct classes / %d distinct styles | unique: %d distinct classes / %d distinct styles\n',
    few.tdCount, few.distinctClasses, few.distinctStyles, uniq.distinctClasses, uniq.distinctStyles)
  // just-styled keeps ONE class (the componentId) regardless of cardinality...
  expect(few.distinctClasses).toBeLessThanOrEqual(2)
  expect(uniq.distinctClasses).toBeLessThanOrEqual(2)
  // ...and expresses cardinality through inline --var values instead.
  expect(few.distinctStyles).toBeLessThanOrEqual(3)
  expect(uniq.distinctStyles).toBeGreaterThan(ROWS * COLS * 0.8)
})
