const { flatten, buildRule, isValuePosition } = require('../../packages/runtime/src/flatten')
const styled = require('styled-components').default

// A tag that runs flatten with a fixed componentId, mirroring how the lazy
// descriptor will call it at first render.
const at = id => (strings, ...interps) => flatten(strings, interps, id)

const theme = { color: { bgColor: '#eee' }, space: [0, 4, 8] }

describe('flatten (module/first-render CSS resolution)', () => {
  it('resolves a shared css fragment and a module theme value — no var, no bail', () => {
    const { css } = require('styled-components')
    const shared = css`
      color: red;
      background-color: ${theme.color.bgColor};
    `
    const r = at('c0')`
      width: 400px;
      height: 500px;
      ${shared}
    `
    expect(r.bail).toBe(false)
    expect(r.vars).toEqual([])
    // everything inlined, including the theme value
    expect(r.css).toMatch(/width:\s*400px/)
    expect(r.css).toMatch(/background-color:\s*#eee/)
  })

  it('resolves a styled component interpolated as a selector', () => {
    const Inner = styled.span`color: green;`
    const r = at('c1')`
      ${Inner} {
        color: blue;
      }
    `
    expect(r.bail).toBe(false)
    expect(r.css).toContain('.' + Inner.styledComponentId)
    // and it compiles to a correctly-nested rule
    const rule = buildRule('js-c1', r.css)
    expect(rule).toMatch(new RegExp('\\.js-c1 \\.' + Inner.styledComponentId + '\\{color:blue;\\}'))
  })

  it('turns a value-position function into a CSS variable', () => {
    const r = at('c2')`
      color: ${props => props.color};
      font-size: 14px;
    `
    expect(r.bail).toBe(false)
    expect(r.vars).toHaveLength(1)
    expect(r.vars[0][0]).toBe('--c2-0')
    expect(typeof r.vars[0][1]).toBe('function')
    expect(r.css).toContain('var(--c2-0)')
    expect(r.css).toMatch(/font-size:\s*14px/)
  })

  it('handles multiple value-position functions', () => {
    const r = at('c3')`
      color: ${p => p.color};
      padding: ${p => p.pad}px;
    `
    expect(r.bail).toBe(false)
    expect(r.vars.map(v => v[0])).toEqual(['--c3-0', '--c3-1'])
    expect(r.css).toContain('var(--c3-0)')
    expect(r.css).toContain('var(--c3-1)')
  })

  it('bails on a conditional/block function', () => {
    const r = at('c4')`
      ${props => props.hasBg && 'background: gray;'}
    `
    expect(r.bail).toBe(true)
  })

  it('bails on a function in selector position', () => {
    const r = at('c5')`
      ${p => p.sel} {
        color: red;
      }
    `
    expect(r.bail).toBe(true)
  })

  it('serializes a style-object interpolation statically', () => {
    const r = at('c6')`
      ${{ color: 'green', fontSize: 12 }}
    `
    expect(r.bail).toBe(false)
    expect(r.css).toMatch(/color:\s*green/)
    expect(r.css).toMatch(/font-size:\s*12px/)
  })

  it('bails on keyframes (needs injection machinery — MVP)', () => {
    const { keyframes } = require('styled-components')
    const spin = keyframes`from{opacity:0}to{opacity:1}`
    const r = at('c7')`
      animation: ${spin} 1s linear;
    `
    expect(r.bail).toBe(true)
  })
})

describe('isValuePosition', () => {
  it('accepts an open declaration value', () => {
    expect(isValuePosition('color: ')).toBe(true)
    expect(isValuePosition('a:1px; color: ')).toBe(true)
    expect(isValuePosition('.foo { color: ')).toBe(true)
  })
  it('rejects block/selector positions', () => {
    expect(isValuePosition('')).toBe(false)
    expect(isValuePosition('width:400px; ')).toBe(false)
    expect(isValuePosition('.foo { ')).toBe(false)
    expect(isValuePosition('color:red; ')).toBe(false)
  })
})
