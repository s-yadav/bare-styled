// Shared widget, compiled two ways by build.mjs:
//   - styled-components (real, wrapper components)
//   - just-styled (plugin -> createStyled -> runtime, flattened to host elements)
// Touches many styled patterns; avoids ThemeProvider/context theme (a known
// just-styled gap) by using a module `theme` constant that resolves statically.
import styled, { css } from 'styled-components'

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
// (rows x cols cells) so node/fiber count scales into real-page territory.
export function Widget({ rows, cols, tick, tintMode = 'few' }) {
  const C = tintMode === 'static' ? CellStatic : Cell
  return (
    <div>
      <Rowc>
        {[0, 1, 2].map(i => (
          <Card key={i} bg={i === tick % 3 ? '#f6f6ff' : '#fff'}>
            <Title>Card {i}</Title>
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
            {cols.map(c => <C key={c} tint={tintFor(tintMode, r, c, cols.length)}>{r + '-' + c}</C>)}
          </tr>
        ))}
      </tbody></table>
    </div>
  )
}
