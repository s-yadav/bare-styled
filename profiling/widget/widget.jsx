// Shared widget, compiled two ways by build.mjs:
//   - styled-components (real, wrapper components)
//   - just-styled (plugin -> createStyled -> runtime, flattened to host elements)
// Touches many styled patterns, with STATIC components at row scale (the
// real-world shape): zero-interp (build-precompiled), const-member and
// fragment-inlined (build-precompiled via the resolver), runtime-static
// (opaque to the build resolver -> idle precompile), a static styled(Styled)
// extender, and a keyframes-animated component (runtime @keyframes injection).
// Avoids ThemeProvider/context theme (a known just-styled gap) by using a
// module `theme` constant that resolves statically.
import styled, { css, keyframes } from 'styled-components'

const theme = { fg: '#222', accent: '#4f46e5', border: '#e5e7eb', muted: '#6b7280' }
const pad = css`padding: 8px 12px;` // css fragment

const Card = styled.div`
  border: 1px solid ${theme.border};
  border-radius: 8px;
  ${pad}
  background: ${p => p.bg}; /* dynamic -> per-component hash class */
`
const Title = styled.h3`font-size: 16px; margin: 0; color: ${theme.fg};` // fully static
const Rowc = styled.div`display: flex; gap: 8px; align-items: center; flex-wrap: wrap;`
const Badge = styled.span`border-radius: 10px; padding: 2px 8px; background: ${p => p.color}; color: #fff; font-size: 11px;`
const Avatar = styled.div`width: 28px; height: 28px; border-radius: 50%; background: ${p => p.color};`
const Button = styled.button`
  border: none; border-radius: 6px; padding: 6px 10px;
  ${p => p.primary && css`background: ${theme.accent}; color: #fff;`} /* block fn -> resolved per render */
`
const IconButton = styled(Button)`padding: 4px 6px;` // styled(StyledComponent)
function CellBase({ className, children }) { return <td className={className}>{children}</td> }
const Cell = styled(CellBase)`padding: 4px 8px; border-bottom: 1px solid ${theme.border}; color: ${p => p.tint};` // dynamic tint -> hash class per distinct value (both libs)
const CellStatic = styled(CellBase)`padding: 4px 8px; border-bottom: 1px solid ${theme.border}; color: #444;` // static tint -> plain class both ways
const Field = styled.input.attrs({ type: 'text' })`border: 1px solid ${theme.border}; padding: 4px; width: 60px;` // .attrs -> untouched (real SC)

// ---- STATIC components, rendered at row scale ----
// zero-interpolation -> build-precompiled
const RowLabel = styled.td`padding: 4px 8px; border-bottom: 1px solid #e5e7eb; color: #94a3b8; font-variant-numeric: tabular-nums;`
// static styled(StyledComponent) extender -> build-precompiled, unwrap chain
const RowLabelStrong = styled(RowLabel)`font-weight: 600; color: #475569;`
// css fragment fully static -> INLINED + build-precompiled by the plugin
const chip = css`border-radius: 10px; padding: 2px 8px; font-size: 11px;`
const TagStatic = styled.span`${chip} background: #eef2ff; color: #3730a3;`
// runtime-static: opaque to the build resolver (Math.random) -> css() flatten
// at definition -> idle precompile path
const alignEnd = Math.random() < 2 ? 'right' : 'left' // always 'right'
const NumCell = styled.td`padding: 4px 8px; border-bottom: 1px solid ${theme.border}; text-align: ${alignEnd}; color: #475569;`
// keyframes -> @keyframes injected into the just-styled sheet at resolve time;
// the component itself is static-after-flatten
const pulse = keyframes`0% { opacity: 0.4; } 100% { opacity: 1; }`
const LiveDot = styled.span`display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: #16a34a; animation: ${pulse} 1.2s ease-in-out infinite alternate;`

// tint value for a cell, by mode:
//   static  -> CellStatic (one static rule; isolates the fiber-only difference)
//   few     -> 2 distinct values (2 cached classes in both libs)
//   unique  -> a distinct value per cell (~rows*cols classes in both libs — worst case)
function tintFor(mode, r, c, cols) {
  if (mode === 'few') return (r + c) % 2 ? '#333' : '#777'
  const n = (r * cols + c) >>> 0
  return '#' + (((n * 2654435761) >>> 8) & 0xffffff).toString(16).padStart(6, '0')
}

// A card header (a handful of nested styled nodes) plus a large table body
// (rows x (cols + 2) cells) so node/fiber count scales into real-page
// territory. Every row carries two static cells (RowLabel / RowLabelStrong +
// NumCell) alongside the tintMode-driven cells, so the static path is
// exercised at row scale in every mode — like a real table with id/label/total
// columns.
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
