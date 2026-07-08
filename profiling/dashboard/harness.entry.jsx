import React from 'react'
import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import { getCss, __resetSheet } from 'just-styled/runtime'
import { App as SCApp } from './.build/sc-dashboard.js'
import { App as JSApp } from './.build/js-dashboard.js'

const median = a => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)] }

// Synchronous mount + re-render timing, forcing a full style+layout flush
// (offsetHeight) each render so browser recalc/layout is included. `isJS` counts
// the dynamic (js-) classes the runtime generated, to show the global-cache dedup.
function bench(App, rows, iters, tintMode, isJS) {
  const rowsArr = Array.from({ length: rows }, (_, i) => i)
  const el = tick => React.createElement(App, { rows: rowsArr, tick, tintMode })

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

  const ruleCount = isJS ? (getCss().match(/\.js-/g) || []).length : null
  return { mount: median(mount), update: median(update), nodeCount, ruleCount }
}

function App() {
  const [rows, setRows] = React.useState(200)
  const [iters, setIters] = React.useState(15)
  const [tintMode, setTintMode] = React.useState('unique')
  const [busy, setBusy] = React.useState(false)
  const [rowsData, setRowsData] = React.useState([])
  const [status, setStatus] = React.useState('Ready.')

  const run = which => () => {
    setBusy(true); setStatus('Running ' + which + '… (tab may pause on large N)')
    requestAnimationFrame(() => setTimeout(() => {
      try {
        const out = []
        if (which === 'styled-components' || which === 'both') out.push(['styled-components', bench(SCApp, rows, iters, tintMode, false)])
        if (which === 'just-styled' || which === 'both') { __resetSheet(); out.push(['just-styled', bench(JSApp, rows, iters, tintMode, true)]) }
        setRowsData(prev => [...prev, ...out.map(([name, r]) => ({ name, rows, tintMode, ...r }))])
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
    inspectRootRef.current.render(React.createElement(Which, { rows: r, tick: 0, tintMode }))
    setStatus('Inspecting ' + which + ' (' + r.length + ' rows, tint=' + tintMode + ') — open DevTools on the panel below')
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
      '  tint ',
      React.createElement('select', { value: tintMode, disabled: busy, style: { font: 'inherit' }, onChange: e => setTintMode(e.target.value) },
        React.createElement('option', { value: 'unique' }, 'unique per row (SC class explosion)'),
        React.createElement('option', { value: 'few' }, 'few (3 shared — global cache = 3 classes)')),
      '  ≈ ', (rows * 6 + 40), ' host nodes/tree'),
    React.createElement('p', null,
      React.createElement('button', { onClick: run('both'), disabled: busy, style: { font: 'inherit', padding: '6px 12px', marginRight: 8 } }, 'Run both'),
      React.createElement('button', { onClick: run('styled-components'), disabled: busy, style: { font: 'inherit', padding: '6px 12px', marginRight: 8 } }, 'styled-components only'),
      React.createElement('button', { onClick: run('just-styled'), disabled: busy, style: { font: 'inherit', padding: '6px 12px', marginRight: 8 } }, 'just-styled only'),
      React.createElement('button', { onClick: () => setRowsData([]), disabled: busy, style: { font: 'inherit', padding: '6px 12px' } }, 'Clear')),
    React.createElement('div', { style: { fontWeight: 600, minHeight: '1.4em' } }, status),
    React.createElement('table', { style: { borderCollapse: 'collapse', marginTop: 12, fontVariantNumeric: 'tabular-nums' } },
      React.createElement('tbody', null,
        React.createElement('tr', null, ['model', 'tint', 'rows', 'DOM nodes', 'js- classes', 'mount ms (median)', 're-render ms (median)'].map((h, i) =>
          React.createElement('th', { key: i, style: { border: '1px solid #ccc', padding: '4px 10px', textAlign: i < 3 ? 'left' : 'right' } }, h))),
        rowsData.map((r, i) =>
          React.createElement('tr', { key: i }, [r.name, r.tintMode, r.rows, r.nodeCount, r.ruleCount == null ? '—' : r.ruleCount, r.mount.toFixed(2), r.update.toFixed(2)].map((v, j) =>
            React.createElement('td', { key: j, style: { border: '1px solid #ccc', padding: '4px 10px', textAlign: j < 3 ? 'left' : 'right' } }, v))))),
    React.createElement('div', { style: { marginTop: 20 } },
      React.createElement('b', null, 'Inspect (leaves DOM mounted): '),
      React.createElement('button', { onClick: inspect('styled-components'), disabled: busy, style: { font: 'inherit', padding: '4px 10px', marginRight: 8 } }, 'styled-components'),
      React.createElement('button', { onClick: inspect('just-styled'), disabled: busy, style: { font: 'inherit', padding: '4px 10px' } }, 'just-styled')),
    React.createElement('div', { ref: inspectRef, style: { marginTop: 10, border: '1px solid #eee', height: 420, overflow: 'auto' } })))
}

createRoot(document.getElementById('root')).render(React.createElement(App))
