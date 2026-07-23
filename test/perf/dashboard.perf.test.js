/**
 * @jest-environment jsdom
 *
 * Real-world app benchmark: a full dashboard (top bar + sidebar nav + stat cards
 * + a large data table) rendered once through real styled-components and once
 * through just-styled, mounted and re-rendered in jsdom. This is the
 * "everything at once" test — it exercises every path the runtime special-cases:
 *
 *   - static chrome (AppShell, TopBar, Sidebar, Th, ...) AND static cells at row
 *     scale (IdCell/PillStatic zero-interp -> build-time compiled (Opt 2);
 *     NameCell const-member -> build-time via resolveMember; ScoreCell css``
 *     fragment -> static-after-flatten at runtime; TotalCell static
 *     styled(StyledComponent) extender) — each registered once under its
 *     componentId, no per-render hash. DASH_MODE picks the row shape:
 *     mixed (default) / static / dynamic.
 *   - low-cardinality dynamic (NavItem active, Row zebra, StatusPill, TrendBadge,
 *     Card trend, Button primary) — hundreds of elements collapsing to a handful
 *     of distinct resolved styles, each hashed + injected once per component
 *     (per-component class cache, matching styled-components).
 *   - high-cardinality dynamic (Tint) — a unique resolved style per table row, so
 *     every cell misses the cache and pays a real hash + insert (worst case).
 *   - styled(StyledComponent) (IconButton) and styled(NonStyled) (DataCell).
 *   - `as` polymorphism (Button rendered as <a>).
 *   - `${Comp}` component selector (Card targeting TrendBadge).
 *   - `.attrs(...)` — left untouched by the plugin, so it runs on real
 *     styled-components even in the just-styled build (the intended fallback).
 *
 * jsdom has no layout/paint, so this isolates the JS/React cost — where the
 * structural win lives: styled-components mounts a wrapper fiber (+ hooks +
 * generateAndInjectStyles) per styled element; just-styled resolves each to a
 * plain host element. For recalc/layout/paint, use the browser harness.
 *
 * Run:  npx jest test/perf/dashboard.perf.test.js
 * Tune: DASH_ROWS / DASH_ITERS env vars.
 */
import { transform } from '@babel/core'
import path from 'path'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import plugin from '../../src/js-transform'
import { fastTransform } from '../../src/fast-transform'
import * as runtime from 'just-styled/runtime'

// Which engine compiles the just-styled variant: 'babel' (default) or 'oxc'.
// Lets the SAME runtime benchmark verify that oxc-compiled output performs
// identically to babel-compiled output.
const ENGINE = process.env.JS_ENGINE || 'babel'

global.IS_REACT_ACT_ENVIRONMENT = true

const ROWS = +process.env.DASH_ROWS || 150
const ITERS = +process.env.DASH_ITERS || 20
// Row shape: 'mixed' (static + dynamic cells — real-world, default), 'static'
// (all-static rows), 'dynamic' (the old all-dynamic rows).
const MODE = process.env.DASH_MODE || 'mixed'

// Escaped \${…} are styled-components interpolations (flattened by just-styled);
// {…} are ordinary JSX expressions. No ThemeProvider (a known just-styled gap) —
// a module `theme` constant instead, which resolves statically. Transient ($)
// props are dropped from the DOM by both libraries (SC convention / emotion
// is-prop-valid), so neither leaks unknown attributes onto host nodes.
const SOURCE = `
  import React from 'react'
  import styled, { css } from 'styled-components'

  const theme = { fg:'#1f2937', muted:'#6b7280', border:'#e5e7eb', accent:'#4f46e5', surface:'#f9fafb' }
  const elevate = css\`box-shadow: 0 1px 2px rgba(0,0,0,0.06);\`
  const statusColors = { ok:'#16a34a', warn:'#d97706', err:'#dc2626' }

  // ---- static chrome: zero-interpolation (Opt 2 build-time compiled) ----
  const AppShell  = styled.div\`display:flex; flex-direction:column; height:100%; font-family:system-ui;\`
  const TopBar    = styled.header\`display:flex; align-items:center; gap:16px; padding:12px 20px; border-bottom:1px solid #e5e7eb;\`
  const Brand     = styled.div\`font-weight:700; font-size:18px;\`
  const Body      = styled.div\`display:flex; flex:1; min-height:0;\`
  const Sidebar   = styled.nav\`width:220px; padding:16px; border-right:1px solid #e5e7eb; background:#f9fafb;\`
  const Main      = styled.main\`flex:1; padding:20px; overflow:auto;\`
  const CardsRow  = styled.div\`display:flex; gap:16px; margin-bottom:20px;\`
  const StatValue = styled.div\`font-size:24px; font-weight:700; display:flex; align-items:center;\`
  const StatLabel = styled.div\`font-size:12px; color:#6b7280;\`
  const TableWrap = styled.div\`border:1px solid #e5e7eb; border-radius:8px; overflow:hidden;\`
  const THead     = styled.thead\`background:#f9fafb;\`
  const Th        = styled.th\`text-align:left; padding:8px 12px; font-size:12px; color:#6b7280;\`

  // ---- static-after-flatten (module value / fragment; hashed once at runtime) ----
  const TrendBadge = styled.span\`font-size:12px; margin-left:6px; color:\${p => p.$up ? statusColors.ok : statusColors.err};\`

  // ---- low-cardinality dynamic (few distinct styles across many elements) ----
  const NavItem = styled.a\`
    display:block; padding:8px 12px; border-radius:6px; text-decoration:none;
    color:\${p => p.$active ? theme.accent : theme.fg};
    background:\${p => p.$active ? '#eef2ff' : 'transparent'};
    font-weight:\${p => p.$active ? 600 : 400};
  \`
  const Row = styled.tr\`background:\${p => p.$odd ? '#ffffff' : '#fafafa'};\`
  const StatusPill = styled.span\`
    padding:2px 8px; border-radius:10px; font-size:12px; color:#fff;
    background:\${p => statusColors[p.$status]};
  \`
  const Card = styled.div\`
    flex:1; padding:16px; border:1px solid \${theme.border}; border-radius:8px; \${elevate}
    background:\${p => p.$trend === 'up' ? '#f0fdf4' : '#fef2f2'};
    \${TrendBadge} { font-weight:600; }                       // component selector
  \`
  const Button = styled.button\`
    border:none; border-radius:6px; padding:6px 12px; cursor:pointer;
    background:\${p => p.$primary ? theme.accent : '#e5e7eb'};
    color:\${p => p.$primary ? '#fff' : theme.fg};
  \`
  const IconButton = styled(Button)\`padding:4px 8px;\`          // styled(StyledComponent)

  // ---- styled(NonStyled) + dynamic ----
  function CellBase({ className, children }) { return <td className={className}>{children}</td> }
  const DataCell = styled(CellBase)\`padding:6px 12px; border-top:1px solid \${theme.border}; color:\${p => p.$dim ? theme.muted : theme.fg};\`

  // ---- high-cardinality dynamic (unique resolved style per row) ----
  const Tint = styled.td\`padding:6px 12px; color:\${p => p.$tint};\`

  // ---- .attrs -> left untouched, runs on real styled-components (fallback) ----
  const Field = styled.input.attrs({ type:'text' })\`border:1px solid \${theme.border}; border-radius:6px; padding:6px 10px;\`

  // ---- STATIC cells, rendered at row scale (rows x N elements) ----
  // zero-interpolation -> build-time compiled (Opt 2)
  const IdCell = styled.td\`padding:6px 12px; border-top:1px solid #e5e7eb; color:#6b7280; font-variant-numeric:tabular-nums;\`
  const PillStatic = styled.span\`padding:2px 8px; border-radius:10px; font-size:12px; color:#fff; background:#64748b;\`
  // const-member interpolations -> static-after-flatten AT BUILD (resolveMember precompile)
  const NameCell = styled.td\`padding:6px 12px; border-top:1px solid \${theme.border}; color:\${theme.fg};\`
  // css fragment kept OPAQUE to the build resolver (Math.random) so this stays
  // live -> static-after-flatten AT RUNTIME (fully-static fragments are now
  // inlined + precompiled at build)
  const alignEnd = Math.random() < 2 ? 'right' : 'left' // always 'right'
  const mono = css\`font-variant-numeric:tabular-nums; text-align:\${alignEnd};\`
  const ScoreCell = styled.td\`padding:6px 12px; border-top:1px solid \${theme.border}; color:\${theme.muted}; \${mono}\`
  // static styled(StyledComponent) -> build-precompiled extender over a runtime-static base
  const TotalCell = styled(ScoreCell)\`font-weight:600; color:#111827;\`

  const NAV = ['Home','Reports','Data','Pipelines','Settings']

  function Cells({ r, tick, mode }) {
    const status = ['ok', 'warn', 'err'][(r + tick) % 3]
    if (mode === 'static') {
      return (
        <>
          <IdCell>{r}</IdCell>
          <NameCell>Item {r}</NameCell>
          <td style={{ padding:'6px 12px' }}><PillStatic>{status}</PillStatic></td>
          <NameCell>user{r % 7}</NameCell>
          <ScoreCell>{(r * 13) % 1000}</ScoreCell>
          <TotalCell>{(r * 29 + tick) % 100}</TotalCell>
        </>
      )
    }
    if (mode === 'dynamic') {
      return (
        <>
          <DataCell>{r}</DataCell>
          <DataCell>Item {r}</DataCell>
          <td style={{ padding:'6px 12px' }}><StatusPill $status={status}>{status}</StatusPill></td>
          <DataCell $dim>user{r % 7}</DataCell>
          <Tint $tint={'hsl(' + ((r * 7 + tick) % 360) + ' 55% 45%)'}>{(r * 13) % 1000}</Tint>
          <DataCell>{(r * 29 + tick) % 100}</DataCell>
        </>
      )
    }
    // mixed (default): static id/name/score cells + dynamic status/owner/tint
    return (
      <>
        <IdCell>{r}</IdCell>
        <NameCell>Item {r}</NameCell>
        <td style={{ padding:'6px 12px' }}><StatusPill $status={status}>{status}</StatusPill></td>
        <DataCell $dim>user{r % 7}</DataCell>
        <Tint $tint={'hsl(' + ((r * 7 + tick) % 360) + ' 55% 45%)'}>{(r * 13) % 1000}</Tint>
        <TotalCell>{(r * 29 + tick) % 100}</TotalCell>
      </>
    )
  }

  export function App({ rows, tick, mode = 'mixed' }) {
    return (
      <AppShell>
        <TopBar>
          <Brand>Prophecy</Brand>
          <Field defaultValue="search" />
          <Button as="a" href="#" $primary={tick % 2 === 0}>New</Button>
          <IconButton>{'⚙'}</IconButton>
        </TopBar>
        <Body>
          <Sidebar>
            {NAV.map((n, i) => (
              <NavItem key={n} href="#" $active={i === tick % NAV.length}>{n}</NavItem>
            ))}
          </Sidebar>
          <Main>
            <CardsRow>
              {[0, 1, 2, 3].map(i => {
                const up = (i + tick) % 2 === 0
                return (
                  <Card key={i} $trend={up ? 'up' : 'down'}>
                    <StatLabel>Metric {i}</StatLabel>
                    <StatValue>{(i + 1) * 100 + tick}<TrendBadge $up={up}>{up ? '▲' : '▼'}</TrendBadge></StatValue>
                  </Card>
                )
              })}
            </CardsRow>
            <TableWrap>
              <table style={{ width:'100%', borderCollapse:'collapse' }}>
                <THead>
                  <tr><Th>ID</Th><Th>Name</Th><Th>Status</Th><Th>Owner</Th><Th>Tint</Th><Th>Score</Th></tr>
                </THead>
                <tbody>
                  {rows.map(r => (
                    <Row key={r} $odd={r % 2 === 0}>
                      <Cells r={r} tick={tick} mode={mode} />
                    </Row>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          </Main>
        </Body>
      </AppShell>
    )
  }
`

function buildApp(useJustStyled) {
  const filename = path.join(__dirname, (useJustStyled ? 'js' : 'sc') + '-dashboard.jsx')
  let source = SOURCE
  const plugins = [require.resolve('@babel/plugin-transform-modules-commonjs')]
  if (useJustStyled) {
    if (ENGINE === 'oxc') {
      // oxc engine compiles the styled templates first; babel below only does
      // JSX/modules — exactly the split the Vite plugin uses in production.
      source = fastTransform(SOURCE, { filename }).code
    } else {
      plugins.unshift(plugin)
    }
  }
  const { code } = transform(source, {
    filename,
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
  return mod.exports.App
}

const median = arr => { const s = [...arr].sort((a, b) => a - b); return s[Math.floor(s.length / 2)] }

function bench(App, countRules) {
  const rows = Array.from({ length: ROWS }, (_, i) => i)
  const el = tick => React.createElement(App, { rows, tick, mode: MODE })

  const mountWith = () => {
    const c = document.createElement('div'); document.body.appendChild(c)
    return { c, root: createRoot(c) }
  }

  for (let w = 0; w < 3; w++) { const { c, root } = mountWith(); act(() => root.render(el(0))); act(() => root.unmount()); c.remove() }

  const mount = []
  let nodeCount = 0
  let ruleCount = 0
  for (let it = 0; it < ITERS; it++) {
    const { c, root } = mountWith()
    const t0 = performance.now(); act(() => root.render(el(0))); mount.push(performance.now() - t0)
    if (it === 0) {
      nodeCount = c.querySelectorAll('*').length
      if (countRules) ruleCount = (runtime.getCss().match(/\.js-/g) || []).length
    }
    act(() => root.unmount()); c.remove()
  }

  const { c, root } = mountWith(); act(() => root.render(el(0)))
  const update = []
  for (let it = 1; it <= ITERS; it++) { const t0 = performance.now(); act(() => root.render(el(it))); update.push(performance.now() - t0) }
  act(() => root.unmount()); c.remove()

  return { mount: median(mount), update: median(update), nodeCount, ruleCount }
}

afterEach(() => { runtime.__resetSheet(); document.body.innerHTML = ''; document.head.innerHTML = '' })

test(`dashboard mount/re-render: styled-components vs just-styled (${ROWS} rows)`, () => {
  const SCApp = buildApp(false)
  runtime.__resetSheet()
  const JSApp = buildApp(true)

  const sc = bench(SCApp, false)
  runtime.__resetSheet(); document.body.innerHTML = ''; document.head.innerHTML = ''
  const js = bench(JSApp, true)

  // Same tree => identical DOM node count both ways.
  expect(js.nodeCount).toBe(sc.nodeCount)

  const pct = (a, b) => (((a - b) / a) * 100).toFixed(0) + '%'
  // eslint-disable-next-line no-console
  console.log(
    `\ndashboard: styled-components vs just-styled[${ENGINE}] — ${ROWS} rows, cells=${MODE} (${sc.nodeCount} DOM nodes), median ms over ${ITERS} iters` +
    `\n                 mount      re-render` +
    `\n  styled-comp   ${sc.mount.toFixed(2).padStart(6)}     ${sc.update.toFixed(2).padStart(6)}` +
    `\n  just-styled   ${js.mount.toFixed(2).padStart(6)}     ${js.update.toFixed(2).padStart(6)}` +
    `\n  delta         ${pct(sc.mount, js.mount).padStart(6)}     ${pct(sc.update, js.update).padStart(6)}  (positive = just-styled faster)` +
    `\n  just-styled generated ${js.ruleCount} dynamic (js-) classes for ${sc.nodeCount} nodes — per-component dedup\n`
  )

  expect(sc.mount).toBeGreaterThan(0)
  expect(js.mount).toBeGreaterThan(0)
})
