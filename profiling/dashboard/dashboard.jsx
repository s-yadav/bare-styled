// Real-world dashboard, compiled two ways by build.mjs:
//   - styled-components (real, wrapper components)
//   - just-styled (plugin -> createStyled -> runtime, flattened to host elements)
//
// Exercises every runtime path at once, with STATIC components at row scale (the
// real-world shape: most table cells / labels / chrome never vary per render):
//   - zero-interpolation static (chrome + IdCell/PillStatic) -> build-time
//     stylis-compiled by the plugin (Opt 2), registered under componentId.
//   - static-after-flatten AT BUILD (NameCell: `${theme.border}` const-member
//     interpolations resolved by the plugin's resolveMember) -> also precompiled.
//   - static-after-flatten AT RUNTIME (ScoreCell: a css`` fragment survives the
//     plugin, css() flattens it to strings at definition) -> idle-precompiled
//     (requestIdleCallback) and registered on first render.
//   - static styled(StyledComponent) (TotalCell extends ScoreCell) -> group-
//     ordered cascade with a descriptor unwrap chain, both rules static.
//   - low-cardinality dynamic (NavItem/Row/StatusPill/TrendBadge/Card/Button ->
//     a handful of per-component cached classes), high-cardinality dynamic
//     (Tint -> a unique style per row), styled(NonStyled) (DataCell), `as`
//     polymorphism, `${Comp}` component selectors, and `.attrs` (untouched ->
//     real SC fallback).
// The `mode` prop picks the row shape: 'mixed' (default; static + dynamic cells,
// closest to a real app), 'static' (all-static rows; isolates the static path),
// 'dynamic' (the old all-dynamic rows). No ThemeProvider (a known just-styled
// gap) — a module `theme` constant that resolves statically. Transient ($) props
// are dropped from the DOM by both libraries.
import styled, { css } from 'styled-components'

const theme = { fg: '#1f2937', muted: '#6b7280', border: '#e5e7eb', accent: '#4f46e5', surface: '#f9fafb' }
const elevate = css`box-shadow: 0 1px 2px rgba(0,0,0,0.06);`
const statusColors = { ok: '#16a34a', warn: '#d97706', err: '#dc2626' }

// ---- static chrome: zero-interpolation (Opt 2 build-time compiled) ----
const AppShell = styled.div`display:flex; flex-direction:column; height:100%; font-family:system-ui;`
const TopBar = styled.header`display:flex; align-items:center; gap:16px; padding:12px 20px; border-bottom:1px solid #e5e7eb;`
const Brand = styled.div`font-weight:700; font-size:18px;`
const Body = styled.div`display:flex; flex:1; min-height:0;`
const Sidebar = styled.nav`width:220px; padding:16px; border-right:1px solid #e5e7eb; background:#f9fafb;`
const Main = styled.main`flex:1; padding:20px; overflow:auto;`
const CardsRow = styled.div`display:flex; gap:16px; margin-bottom:20px;`
const StatValue = styled.div`font-size:24px; font-weight:700; display:flex; align-items:center;`
const StatLabel = styled.div`font-size:12px; color:#6b7280;`
const TableWrap = styled.div`border:1px solid #e5e7eb; border-radius:8px; overflow:hidden;`
const THead = styled.thead`background:#f9fafb;`
const Th = styled.th`text-align:left; padding:8px 12px; font-size:12px; color:#6b7280;`

// ---- static-after-flatten (module value; hashed once at runtime) ----
const TrendBadge = styled.span`font-size:12px; margin-left:6px; color:${p => (p.$up ? statusColors.ok : statusColors.err)};`

// ---- low-cardinality dynamic (few distinct styles across many elements) ----
const NavItem = styled.a`
  display:block; padding:8px 12px; border-radius:6px; text-decoration:none;
  color:${p => (p.$active ? theme.accent : theme.fg)};
  background:${p => (p.$active ? '#eef2ff' : 'transparent')};
  font-weight:${p => (p.$active ? 600 : 400)};
`
const Row = styled.tr`background:${p => (p.$odd ? '#ffffff' : '#fafafa')};`
const StatusPill = styled.span`
  padding:2px 8px; border-radius:10px; font-size:12px; color:#fff;
  background:${p => statusColors[p.$status]};
`
const Card = styled.div`
  flex:1; padding:16px; border:1px solid ${theme.border}; border-radius:8px; ${elevate}
  background:${p => (p.$trend === 'up' ? '#f0fdf4' : '#fef2f2')};
  ${TrendBadge} { font-weight:600; } /* component selector */
`
const Button = styled.button`
  border:none; border-radius:6px; padding:6px 12px; cursor:pointer;
  background:${p => (p.$primary ? theme.accent : '#e5e7eb')};
  color:${p => (p.$primary ? '#fff' : theme.fg)};
`
const IconButton = styled(Button)`padding:4px 8px;` // styled(StyledComponent)

// ---- styled(NonStyled) + dynamic ----
function CellBase({ className, children }) { return <td className={className}>{children}</td> }
const DataCell = styled(CellBase)`padding:6px 12px; border-top:1px solid ${theme.border}; color:${p => (p.$dim ? theme.muted : theme.fg)};`

// ---- high-cardinality dynamic (unique resolved style per row) ----
const Tint = styled.td`padding:6px 12px; color:${p => p.$tint};`

// ---- STATIC cells, rendered at row scale (rows x N elements) ----
// zero-interpolation -> build-time compiled (Opt 2)
const IdCell = styled.td`padding:6px 12px; border-top:1px solid #e5e7eb; color:#6b7280; font-variant-numeric:tabular-nums;`
const PillStatic = styled.span`padding:2px 8px; border-radius:10px; font-size:12px; color:#fff; background:#64748b;`
// const-member interpolations -> static-after-flatten AT BUILD (resolveMember precompile)
const NameCell = styled.td`padding:6px 12px; border-top:1px solid ${theme.border}; color:${theme.fg};`
// css`` fragment kept OPAQUE to the build resolver (Math.random can't be
// evaluated at build) so this stays a live template -> css() flattens it to
// strings at definition -> static-after-flatten AT RUNTIME (idle precompile).
// (A fully-static fragment would now be inlined and precompiled at build.)
const alignEnd = Math.random() < 2 ? 'right' : 'left' // always 'right'
const mono = css`font-variant-numeric:tabular-nums; text-align:${alignEnd};`
const ScoreCell = styled.td`padding:6px 12px; border-top:1px solid ${theme.border}; color:${theme.muted}; ${mono}`
// static styled(StyledComponent) -> build-precompiled extender over a runtime-static base
const TotalCell = styled(ScoreCell)`font-weight:600; color:#111827;`

// ---- .attrs -> left untouched, runs on real styled-components (fallback) ----
const Field = styled.input.attrs({ type: 'text' })`border:1px solid ${theme.border}; border-radius:6px; padding:6px 10px;`

const NAV = ['Home', 'Reports', 'Data', 'Pipelines', 'Settings']

// tintMode:
//   unique -> a distinct color per row (worst case: every cell misses the cache)
//   few    -> 3 shared colors (global cache collapses them to 3 classes total)
function tintFor(mode, r, tick) {
  if (mode === 'few') return ['#334155', '#6b7280', '#0f172a'][r % 3]
  return 'hsl(' + ((r * 7 + tick) % 360) + ' 55% 45%)'
}

// One table row; `mode` picks the cell mix (see header comment).
function Cells({ r, tick, tintMode, mode }) {
  const status = ['ok', 'warn', 'err'][(r + tick) % 3]
  if (mode === 'static') {
    return (
      <>
        <IdCell>{r}</IdCell>
        <NameCell>Item {r}</NameCell>
        <td style={{ padding: '6px 12px' }}><PillStatic>{status}</PillStatic></td>
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
        <td style={{ padding: '6px 12px' }}><StatusPill $status={status}>{status}</StatusPill></td>
        <DataCell $dim>user{r % 7}</DataCell>
        <Tint $tint={tintFor(tintMode, r, tick)}>{(r * 13) % 1000}</Tint>
        <DataCell>{(r * 29 + tick) % 100}</DataCell>
      </>
    )
  }
  // mixed (default): static id/name/score cells + dynamic status/owner/tint
  return (
    <>
      <IdCell>{r}</IdCell>
      <NameCell>Item {r}</NameCell>
      <td style={{ padding: '6px 12px' }}><StatusPill $status={status}>{status}</StatusPill></td>
      <DataCell $dim>user{r % 7}</DataCell>
      <Tint $tint={tintFor(tintMode, r, tick)}>{(r * 13) % 1000}</Tint>
      <TotalCell>{(r * 29 + tick) % 100}</TotalCell>
    </>
  )
}

export function App({ rows, tick, tintMode = 'unique', mode = 'mixed' }) {
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
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <THead>
                <tr><Th>ID</Th><Th>Name</Th><Th>Status</Th><Th>Owner</Th><Th>Tint</Th><Th>Score</Th></tr>
              </THead>
              <tbody>
                {rows.map(r => (
                  <Row key={r} $odd={r % 2 === 0}>
                    <Cells r={r} tick={tick} tintMode={tintMode} mode={mode} />
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
