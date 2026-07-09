import React from 'react'
import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import { getCss, __resetSheet } from 'just-styled/runtime'
import { App as SCApp } from './.build/sc-dashboard.js'
import { App as JSApp } from './.build/js-dashboard.js'

const median = a => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)] }

// Top-level rule count of a compiled css string (brace depth 0).
function countTopRules(css) {
  let depth = 0, n = 0
  for (let i = 0; i < css.length; i++) {
    const ch = css.charCodeAt(i)
    if (ch === 123) depth++
    else if (ch === 125 && --depth === 0) n++
  }
  return n
}

// Synchronous mount + re-render timing, forcing a full style+layout flush
// (offsetHeight) each render so browser recalc/layout is included. For the js
// build we report dynamic (js-) classes AND total rules (static rules register
// under their componentId, so js- alone under-counts in static/mixed modes).
function bench(App, rows, iters, tintMode, mode, isJS) {
  const rowsArr = Array.from({ length: rows }, (_, i) => i)
  const el = tick => React.createElement(App, { rows: rowsArr, tick, tintMode, mode })

  let nodeCount = 0
  for (let w = 0; w < 3; w++) {
    const c = document.createElement('div'); document.body.appendChild(c)
    const root = createRoot(c)
    flushSync(() => root.render(el(0))); c.offsetHeight
    if (w === 0) nodeCount = c.querySelectorAll('*').length
    flushSync(() => root.unmount()); c.remove()
  }

  const mount = []
  for (let it = 0; it < iters; it++) {
    const c = document.createElement('div'); document.body.appendChild(c)
    const root = createRoot(c)
    const t0 = performance.now()
    flushSync(() => root.render(el(0))); c.offsetHeight
    mount.push(performance.now() - t0)
    flushSync(() => root.unmount()); c.remove()
  }

  const c = document.createElement('div'); document.body.appendChild(c)
  const root = createRoot(c)
  flushSync(() => root.render(el(0))); c.offsetHeight
  const update = []
  for (let it = 1; it <= iters; it++) {
    const t0 = performance.now()
    flushSync(() => root.render(el(it))); c.offsetHeight
    update.push(performance.now() - t0)
  }
  flushSync(() => root.unmount()); c.remove()

  const css = isJS ? getCss() : null
  const ruleCount = isJS ? (css.match(/\.js-/g) || []).length : null
  const totalRules = isJS ? countTopRules(css) : null
  return { mount: median(mount), update: median(update), nodeCount, ruleCount, totalRules }
}

function App() {
  const [rows, setRows] = React.useState(200)
  const [iters, setIters] = React.useState(15)
  const [tintMode, setTintMode] = React.useState('unique')
  const [mode, setMode] = React.useState('mixed')
  const [busy, setBusy] = React.useState(false)
  const [rowsData, setRowsData] = React.useState([])
  const [status, setStatus] = React.useState('Ready.')

  const run = which => () => {
    setBusy(true); setStatus('Running ' + which + '… (tab may pause on large N)')
    requestAnimationFrame(() => setTimeout(() => {
      try {
        const out = []
        if (which === 'styled-components' || which === 'both') out.push(['styled-components', bench(SCApp, rows, iters, tintMode, mode, false)])
        if (which === 'just-styled' || which === 'both') { __resetSheet(); out.push(['just-styled', bench(JSApp, rows, iters, tintMode, mode, true)]) }
        setRowsData(prev => [...prev, ...out.map(([name, r]) => ({ name, rows, tintMode, mode, ...r }))])
        setStatus('Done: ' + which + (out[0] ? ' — ' + out[0][1].nodeCount + ' DOM nodes/tree' : ''))
      } catch (e) {
        setStatus('Error: ' + (e && e.message || e)); console.error(e)
      } finally { setBusy(false) }
    }, 0))
  }

  // Leave one model mounted for DevTools inspection (timed runs unmount).
  const inspectRef = React.useRef(null)
  const inspectRootRef = React.useRef(null)
  const inspect = which => () => {
    const Which = which === 'just-styled' ? JSApp : SCApp
    if (inspectRootRef.current) inspectRootRef.current.unmount()
    inspectRootRef.current = createRoot(inspectRef.current)
    const r = Array.from({ length: Math.min(rows, 20) }, (_, i) => i)
    inspectRootRef.current.render(React.createElement(Which, { rows: r, tick: 0, tintMode, mode }))
    setStatus('Inspecting ' + which + ' (' + r.length + ' rows, tint=' + tintMode + ', mode=' + mode + ') — open DevTools on the panel below')
  }

  const num = (v, set) => React.createElement('input', {
    type: 'number', value: v, disabled: busy, style: { width: 80, font: 'inherit' },
    onChange: e => set(+e.target.value || 0)
  })

  return React.createElement('div', { style: { font: '14px system-ui, sans-serif', maxWidth: 1000 } },
    React.createElement('h1', null, 'Dashboard render cost: styled-components vs just-styled'),
    React.createElement('p', { style: { color: '#666' } },
      'A full app tree (top bar + sidebar nav + stat cards + a large data table), rendered through real ',
      'styled-components vs the just-styled plugin+runtime. Exercises static chrome, low- and high-cardinality ',
      'dynamic styles, styled(Component), `as`, and component selectors. Times mount and re-render (each forces ',
      'a style+layout flush). For the recalc/layout/paint split, record a run in the DevTools Performance panel.'),
    React.createElement('div', null,
      'rows ', num(rows, setRows), '  iters ', num(iters, setIters),
      '  cells ',
      React.createElement('select', { value: mode, disabled: busy, style: { font: 'inherit' }, onChange: e => setMode(e.target.value) },
        React.createElement('option', { value: 'mixed' }, 'mixed (static + dynamic — real-world)'),
        React.createElement('option', { value: 'static' }, 'static (all cells static — isolates static path)'),
        React.createElement('option', { value: 'dynamic' }, 'dynamic (all cells dynamic)')),
      '  tint ',
      React.createElement('select', { value: tintMode, disabled: busy, style: { font: 'inherit' }, onChange: e => setTintMode(e.target.value) },
        React.createElement('option', { value: 'unique' }, 'unique per row (per-variant class per row)'),
        React.createElement('option', { value: 'few' }, 'few (3 shared values)')),
      '  ≈ ', (rows * 6 + 40), ' host nodes/tree'),
    React.createElement('p', null,
      React.createElement('button', { onClick: run('both'), disabled: busy, style: { font: 'inherit', padding: '6px 12px', marginRight: 8 } }, 'Run both'),
      React.createElement('button', { onClick: run('styled-components'), disabled: busy, style: { font: 'inherit', padding: '6px 12px', marginRight: 8 } }, 'styled-components only'),
      React.createElement('button', { onClick: run('just-styled'), disabled: busy, style: { font: 'inherit', padding: '6px 12px', marginRight: 8 } }, 'just-styled only'),
      React.createElement('button', { onClick: () => setRowsData([]), disabled: busy, style: { font: 'inherit', padding: '6px 12px' } }, 'Clear')),
    React.createElement('div', { style: { fontWeight: 600, minHeight: '1.4em' } }, status),
    React.createElement('table', { style: { borderCollapse: 'collapse', marginTop: 12, fontVariantNumeric: 'tabular-nums' } },
      React.createElement('tbody', null,
        React.createElement('tr', null, ['model', 'cells', 'tint', 'rows', 'DOM nodes', 'js- classes', 'rules', 'mount ms (median)', 're-render ms (median)'].map((h, i) =>
          React.createElement('th', { key: i, style: { border: '1px solid #ccc', padding: '4px 10px', textAlign: i < 4 ? 'left' : 'right' } }, h))),
        rowsData.map((r, i) =>
          React.createElement('tr', { key: i }, [r.name, r.mode, r.tintMode, r.rows, r.nodeCount, r.ruleCount == null ? '—' : r.ruleCount, r.totalRules == null ? '—' : r.totalRules, r.mount.toFixed(2), r.update.toFixed(2)].map((v, j) =>
            React.createElement('td', { key: j, style: { border: '1px solid #ccc', padding: '4px 10px', textAlign: j < 4 ? 'left' : 'right' } }, v))))),
    React.createElement('div', { style: { marginTop: 20 } },
      React.createElement('b', null, 'Inspect (leaves DOM mounted): '),
      React.createElement('button', { onClick: inspect('styled-components'), disabled: busy, style: { font: 'inherit', padding: '4px 10px', marginRight: 8 } }, 'styled-components'),
      React.createElement('button', { onClick: inspect('just-styled'), disabled: busy, style: { font: 'inherit', padding: '4px 10px' } }, 'just-styled')),
    React.createElement('div', { ref: inspectRef, style: { marginTop: 10, border: '1px solid #eee', height: 420, overflow: 'auto' } })))
}

createRoot(document.getElementById('root')).render(React.createElement(App))
