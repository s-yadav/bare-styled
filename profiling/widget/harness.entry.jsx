import React from 'react'
import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import { Widget as SCWidget } from './.build/sc-widget.js'
import { Widget as JSWidget } from './.build/js-widget.js'

const median = a => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)] }

// Synchronous mount + re-render timing, forcing a full style+layout flush
// (offsetHeight) each render so browser recalc/layout is included.
function bench(Widget, rows, cols, iters, tintMode) {
  const rowsArr = Array.from({ length: rows }, (_, i) => i)
  const colsArr = Array.from({ length: cols }, (_, i) => i)
  const el = tick => React.createElement(Widget, { rows: rowsArr, cols: colsArr, tick, tintMode })

  // warmup + node count
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

  return { mount: median(mount), update: median(update), nodeCount }
}

function App() {
  const [rows, setRows] = React.useState(250)
  const [cols, setCols] = React.useState(8)
  const [iters, setIters] = React.useState(15)
  const [tintMode, setTintMode] = React.useState('few')
  const [busy, setBusy] = React.useState(false)
  const [rowsData, setRowsData] = React.useState([])
  const [status, setStatus] = React.useState('Ready.')

  const run = which => () => {
    setBusy(true); setStatus('Running ' + which + '… (tab may pause on large N)')
    // let the status paint, then run synchronously
    requestAnimationFrame(() => setTimeout(() => {
      try {
        const out = []
        if (which === 'styled-components' || which === 'both') out.push(['styled-components', bench(SCWidget, rows, cols, iters, tintMode)])
        if (which === 'just-styled' || which === 'both') out.push(['just-styled', bench(JSWidget, rows, cols, iters, tintMode)])
        setRowsData(prev => {
          const added = out.map(([name, r]) => ({ name, rows, cols, tintMode, ...r }))
          // Attach % improvement (positive = just-styled faster) to NEW
          // just-styled rows only, computed ONCE at insertion: pair with the
          // styled-components run from this same batch ("Run both"), else the
          // latest earlier run with the same config. Existing rows are frozen —
          // later runs never rewrite a delta already shown.
          for (const row of added) {
            if (row.name !== 'just-styled') continue
            const sc =
              added.find(o => o.name === 'styled-components') ||
              [...prev].reverse().find(o =>
                o.name === 'styled-components' && o.rows === row.rows &&
                o.cols === row.cols && o.tintMode === row.tintMode)
            row.dMount = sc ? ((sc.mount - row.mount) / sc.mount * 100).toFixed(0) + '%' : null
            row.dUpdate = sc ? ((sc.update - row.update) / sc.update * 100).toFixed(0) + '%' : null
          }
          return [...prev, ...added]
        })
        setStatus('Done: ' + which + (out[0] ? ' — ' + out[0][1].nodeCount + ' DOM nodes/tree' : ''))
      } catch (e) {
        setStatus('Error: ' + (e && e.message || e)); console.error(e)
      } finally { setBusy(false) }
    }, 0))
  }

  // Render a small grid of one model and LEAVE it mounted, so the DOM (classes,
  // inline styles) can be inspected in DevTools — the timed runs unmount their trees.
  const inspectRef = React.useRef(null)
  const inspectRootRef = React.useRef(null)
  const inspect = which => () => {
    const Widget = which === 'just-styled' ? JSWidget : SCWidget
    if (inspectRootRef.current) inspectRootRef.current.unmount()
    inspectRootRef.current = createRoot(inspectRef.current)
    const r = Array.from({ length: Math.min(rows, 12) }, (_, i) => i)
    const c = Array.from({ length: Math.min(cols, 8) }, (_, i) => i)
    inspectRootRef.current.render(React.createElement(Widget, { rows: r, cols: c, tick: 0, tintMode }))
    setStatus('Inspecting ' + which + ' (' + r.length + '×' + c.length + ', tint=' + tintMode + ') — open DevTools on the grid below')
  }

  const num = (v, set) => React.createElement('input', {
    type: 'number', value: v, disabled: busy, style: { width: 80, font: 'inherit' },
    onChange: e => set(+e.target.value || 0)
  })

  return React.createElement('div', { style: { font: '14px system-ui, sans-serif', maxWidth: 940 } },
    React.createElement('h1', null, 'Widget render cost: styled-components vs just-styled'),
    React.createElement('p', { style: { color: '#666' } },
      'Same widget tree, rendered through real styled-components vs the just-styled plugin+runtime. ',
      'Times mount and re-render (each forces a style+layout flush). Raise rows/cols to grow the ',
      'node & fiber count toward a real page. For the recalc/layout/paint split, record a run in the ',
      'DevTools Performance panel.'),
    React.createElement('div', null,
      'rows ', num(rows, setRows), '  cols ', num(cols, setCols), '  iters ', num(iters, setIters),
      '  tint ',
      React.createElement('select', { value: tintMode, disabled: busy, style: { font: 'inherit' }, onChange: e => setTintMode(e.target.value) },
        React.createElement('option', { value: 'static' }, 'static (one rule both ways)'),
        React.createElement('option', { value: 'few' }, 'few (2 shared values)'),
        React.createElement('option', { value: 'unique' }, 'unique per cell (class per variant)')),
      '  ≈ ', (rows * cols + 3 * 6 + rows + 4), ' host nodes/tree'),
    React.createElement('p', null,
      React.createElement('button', { onClick: run('both'), disabled: busy, style: { font: 'inherit', padding: '6px 12px', marginRight: 8 } }, 'Run both'),
      React.createElement('button', { onClick: run('styled-components'), disabled: busy, style: { font: 'inherit', padding: '6px 12px', marginRight: 8 } }, 'styled-components only'),
      React.createElement('button', { onClick: run('just-styled'), disabled: busy, style: { font: 'inherit', padding: '6px 12px', marginRight: 8 } }, 'just-styled only'),
      React.createElement('button', { onClick: () => setRowsData([]), disabled: busy, style: { font: 'inherit', padding: '6px 12px' } }, 'Clear')),
    React.createElement('div', { style: { fontWeight: 600, minHeight: '1.4em' } }, status),
    React.createElement('table', { style: { borderCollapse: 'collapse', marginTop: 12, fontVariantNumeric: 'tabular-nums' } },
      React.createElement('tbody', null,
        React.createElement('tr', null, ['model', 'tint', 'rows', 'cols', 'DOM nodes', 'mount ms (median)', 're-render ms (median)', 'Δ mount', 'Δ re-render'].map((h, i) =>
          React.createElement('th', { key: i, style: { border: '1px solid #ccc', padding: '4px 10px', textAlign: i < 4 ? 'left' : 'right' } }, h))),
        rowsData.map((r, i) =>
          React.createElement('tr', { key: i }, [r.name, r.tintMode, r.rows, r.cols, r.nodeCount, r.mount.toFixed(2), r.update.toFixed(2), r.dMount || '—', r.dUpdate || '—'].map((v, j) =>
            React.createElement('td', { key: j, style: { border: '1px solid #ccc', padding: '4px 10px', textAlign: j < 4 ? 'left' : 'right', fontWeight: j >= 7 && v !== '—' ? 600 : 400 } }, v)))),
        rowsData.some(r => r.dMount) ? React.createElement('tr', { key: 'note' },
          React.createElement('td', { colSpan: 9, style: { border: 'none', padding: '6px 10px', color: '#666', fontSize: 12 } },
            'Δ = just-styled improvement vs the latest styled-components run with the same config (positive = just-styled faster).')) : null)),
    React.createElement('div', { style: { marginTop: 20 } },
      React.createElement('b', null, 'Inspect (leaves DOM mounted): '),
      React.createElement('button', { onClick: inspect('styled-components'), disabled: busy, style: { font: 'inherit', padding: '4px 10px', marginRight: 8 } }, 'styled-components'),
      React.createElement('button', { onClick: inspect('just-styled'), disabled: busy, style: { font: 'inherit', padding: '4px 10px' } }, 'just-styled')),
    React.createElement('div', { ref: inspectRef, style: { marginTop: 10 } }))
}

createRoot(document.getElementById('root')).render(React.createElement(App))
