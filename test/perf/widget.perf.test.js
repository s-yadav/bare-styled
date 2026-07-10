/**
 * @jest-environment jsdom
 *
 * End-to-end render comparison: the SAME widget tree, rendered once through real
 * styled-components and once through just-styled (compiled with the plugin +
 * resolved by the runtime). Measures mount and re-render wall-clock in jsdom.
 *
 * jsdom has no layout/paint engine, so this isolates the JS/React side — where
 * just-styled's structural difference lives: styled-components mounts a wrapper
 * component (extra fiber + hooks + generateAndInjectStyles) per styled element,
 * while just-styled resolves each to a plain host element. For real
 * recalc/layout/paint numbers, use the browser harness (profiling/*.html).
 *
 * Run:  npx jest test/perf/widget.perf.test.js
 * Tune: WIDGET_ROWS / WIDGET_COLS / WIDGET_ITERS env vars.
 */
import { transform } from '@babel/core'
import path from 'path'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import plugin from '../../src/js-transform'
import * as runtime from 'just-styled/runtime'

global.IS_REACT_ACT_ENVIRONMENT = true

const ROWS = +process.env.WIDGET_ROWS || 60
const COLS = +process.env.WIDGET_COLS || 5
const ITERS = +process.env.WIDGET_ITERS || 25
// Cell mix: 'few' (2 shared dynamic tints, default), 'unique' (a distinct tint
// per cell — per-variant class worst case), 'static' (all tint cells static).
const TINT = process.env.WIDGET_TINT || 'few'

// A widget touching many styled patterns, with STATIC components at row scale
// (two static cells per row in every mode — the real-world id/label/total-column
// shape). Escaped \${…} are styled-components interpolations (resolved at
// flatten by just-styled); {…} are JSX expressions. Deliberately avoids
// ThemeProvider/context theme (a known just-styled gap); uses a module `theme`
// constant instead, which resolves statically.
const SOURCE = `
  import React from 'react'
  import styled, { css, keyframes } from 'styled-components'

  const theme = { fg: '#222', accent: '#4f46e5', border: '#e5e7eb' }
  const pad = css\`padding: 8px 12px;\`                                  // css fragment

  const Card = styled.div\`
    border: 1px solid \${theme.border}; border-radius: 8px; \${pad}      // module value + fragment
    background: \${p => p.bg};                                           // dynamic -> hash class
  \`
  const Title = styled.h3\`font-size: 16px; margin: 0; color: \${theme.fg};\`  // static (build-precompiled)
  const Rowc = styled.div\`display: flex; gap: 8px; align-items: center;\`
  const Badge = styled.span\`border-radius: 10px; padding: 2px 8px; background: \${p => p.color}; color: #fff;\`
  const Avatar = styled.div\`width: 28px; height: 28px; border-radius: 50%; background: \${p => p.color};\`
  const Button = styled.button\`
    border: none; border-radius: 6px; padding: 6px 10px;
    \${p => p.primary && css\`background: \${theme.accent}; color: white;\`}   // block fn -> resolved per render
  \`
  const IconButton = styled(Button)\`padding: 4px 6px;\`                  // styled(StyledComponent)
  function CellBase({ className, children }) { return <td className={className}>{children}</td> }
  const Cell = styled(CellBase)\`padding: 4px 8px; border-bottom: 1px solid \${theme.border}; color: \${p => p.tint};\`  // styled(NonStyled) + dynamic
  const CellStatic = styled(CellBase)\`padding: 4px 8px; border-bottom: 1px solid \${theme.border}; color: #444;\`      // static tint cell
  const Field = styled.input.attrs({ type: 'text' })\`border: 1px solid \${theme.border};\`   // .attrs -> untouched (real SC)

  // ---- STATIC components, rendered at row scale ----
  const RowLabel = styled.td\`padding: 4px 8px; border-bottom: 1px solid #e5e7eb; color: #94a3b8; font-variant-numeric: tabular-nums;\` // zero-interp
  const RowLabelStrong = styled(RowLabel)\`font-weight: 600; color: #475569;\`   // static styled(Styled) extender
  const chip = css\`border-radius: 10px; padding: 2px 8px; font-size: 11px;\`
  const TagStatic = styled.span\`\${chip} background: #eef2ff; color: #3730a3;\` // fragment -> inlined at build
  const alignEnd = Math.random() < 2 ? 'right' : 'left'                        // opaque to the build resolver
  const NumCell = styled.td\`padding: 4px 8px; border-bottom: 1px solid \${theme.border}; text-align: \${alignEnd}; color: #475569;\` // runtime-static
  const pulse = keyframes\`0% { opacity: 0.4; } 100% { opacity: 1; }\`
  const LiveDot = styled.span\`display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: #16a34a; animation: \${pulse} 1.2s ease-in-out infinite alternate;\` // keyframes injection

  function tintFor(mode, r, c, cols) {
    if (mode === 'few') return (r + c) % 2 ? '#333' : '#777'
    const n = (r * cols + c) >>> 0
    return '#' + (((n * 2654435761) >>> 8) & 0xffffff).toString(16).padStart(6, '0')
  }

  export function Widget({ rows, cols, tick, tintMode = 'few' }) {
    const C = tintMode === 'static' ? CellStatic : Cell
    return (
      <div>
        <Rowc>
          {[0, 1, 2].map(i => (
            <Card key={i} bg={i === tick % 3 ? '#f6f6ff' : '#fff'}>
              <Title>Card {i}</Title>
              <TagStatic>live</TagStatic>
              <LiveDot />
              <Badge color={['#e11d48', '#16a34a', '#2563eb'][i]}>{i + tick}</Badge>
              <Avatar color={'hsl(' + ((i * 40 + tick) % 360) + ' 60% 60%)'} />
              <IconButton primary={i === 0}>Go</IconButton>
              <Field defaultValue="x" />
            </Card>
          ))}
        </Rowc>
        <table><tbody>
          {rows.map(r => (
            <tr key={r}>
              {r % 5 === 0 ? <RowLabelStrong>{r}</RowLabelStrong> : <RowLabel>{r}</RowLabel>}
              {cols.map(c => <C key={c} tint={tintFor(tintMode, r, c, cols.length)}>{r + '-' + c}</C>)}
              <NumCell>{(r * 13) % 997}</NumCell>
            </tr>
          ))}
        </tbody></table>
      </div>
    )
  }
`

// Compile the source either as plain styled-components or through just-styled.
function buildWidget(useJustStyled) {
  const plugins = [require.resolve('@babel/plugin-transform-modules-commonjs')]
  if (useJustStyled) plugins.unshift(plugin)
  const { code } = transform(SOURCE, {
    filename: path.join(__dirname, (useJustStyled ? 'js' : 'sc') + '-widget.jsx'),
    babelrc: false,
    configFile: false,
    presets: [[require.resolve('@babel/preset-react'), { runtime: 'classic' }]],
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

const median = arr => { const s = [...arr].sort((a, b) => a - b); return s[Math.floor(s.length / 2)] }

function bench(Widget) {
  const rows = Array.from({ length: ROWS }, (_, i) => i)
  const cols = Array.from({ length: COLS }, (_, i) => i)
  const el = tick => React.createElement(Widget, { rows, cols, tick, tintMode: TINT })

  const mountWith = () => {
    const c = document.createElement('div'); document.body.appendChild(c)
    const root = createRoot(c)
    return { c, root }
  }

  // warmup
  for (let w = 0; w < 3; w++) { const { c, root } = mountWith(); act(() => root.render(el(0))); act(() => root.unmount()); c.remove() }

  // mount
  const mount = []
  let nodeCount = 0
  for (let it = 0; it < ITERS; it++) {
    const { c, root } = mountWith()
    const t0 = performance.now(); act(() => root.render(el(0))); mount.push(performance.now() - t0)
    if (it === 0) nodeCount = c.querySelectorAll('*').length
    act(() => root.unmount()); c.remove()
  }

  // re-render (dynamic values change each tick)
  const { c, root } = mountWith(); act(() => root.render(el(0)))
  const update = []
  for (let it = 1; it <= ITERS; it++) { const t0 = performance.now(); act(() => root.render(el(it))); update.push(performance.now() - t0) }
  act(() => root.unmount()); c.remove()

  return { mount: median(mount), update: median(update), nodeCount }
}

afterEach(() => { runtime.__resetSheet(); document.body.innerHTML = ''; document.head.innerHTML = '' })

test(`widget mount/re-render: styled-components vs just-styled (${ROWS}x${COLS})`, () => {
  const SCWidget = buildWidget(false)
  const JSWidget = buildWidget(true)

  const sc = bench(SCWidget)
  const js = bench(JSWidget)

  // Same tree => same DOM node count both ways.
  expect(js.nodeCount).toBe(sc.nodeCount)

  const pct = (a, b) => (((a - b) / a) * 100).toFixed(0) + '%'
  // eslint-disable-next-line no-console
  console.log(
    `\njust-styled vs styled-components — widget ${ROWS}x${COLS}, tint=${TINT} (${sc.nodeCount} DOM nodes), median ms over ${ITERS} iters` +
    `\n                 mount      re-render` +
    `\n  styled-comp   ${sc.mount.toFixed(2).padStart(6)}     ${sc.update.toFixed(2).padStart(6)}` +
    `\n  just-styled   ${js.mount.toFixed(2).padStart(6)}     ${js.update.toFixed(2).padStart(6)}` +
    `\n  delta         ${pct(sc.mount, js.mount).padStart(6)}     ${pct(sc.update, js.update).padStart(6)}  (positive = just-styled faster)\n`
  )

  // Sanity only (not a hard perf gate — jsdom timing is noisy):
  expect(sc.mount).toBeGreaterThan(0)
  expect(js.mount).toBeGreaterThan(0)
})
