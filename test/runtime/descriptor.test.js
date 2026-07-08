import { IS_STYLED, createStyled, getCss, __resetSheet } from 'just-styled/runtime'
const engine = require('../../packages/runtime/src/engine')

const tag = (strings, ...interps) => engine.cacheParts(strings, interps)

beforeEach(() => __resetSheet())

describe('engine (render-time hash-class resolution)', () => {
  it('resolves static css', () => {
    const parts = tag`color: red; font-size: 14px;`
    expect(engine.resolveParts(parts, {})).toMatch(/color:\s*red/)
  })

  it('resolves prop functions against props', () => {
    const parts = tag`color: ${p => p.color};`
    expect(engine.resolveParts(parts, { color: 'tomato' })).toMatch(/color:\s*tomato/)
    expect(engine.resolveParts(parts, { color: 'blue' })).toMatch(/color:\s*blue/)
  })

  it('classFor: same resolved css -> same class (registered once); different -> different', () => {
    const a = engine.classFor('sc-x', 'color:red;')
    const a2 = engine.classFor('sc-x', 'color:red;')
    const b = engine.classFor('sc-x', 'color:blue;')
    expect(a).toBe(a2)
    expect(a).not.toBe(b)
    expect(a).toMatch(/^js-[a-z0-9]+$/)
    // registered once each, into the shared sheet
    expect((getCss().match(new RegExp('\\.' + a + '\\{', 'g')) || []).length).toBe(1)
    expect(getCss()).toContain('.' + b + '{color:blue;}')
  })
})

describe('createStyled descriptor shape', () => {
  it('is a self-referencing, SC-targetable descriptor with cached parts', () => {
    const El = createStyled('div', { componentId: 'sc-abc', displayName: 'Box' })`color: red;`
    expect(El[IS_STYLED]).toBe(El) // hoisting-proof discriminator
    expect(El.component).toBe('div')
    expect(El.componentId).toBe('sc-abc')
    expect(El.styledComponentId).toBe('sc-abc')
    expect(El.displayName).toBe('Box')
    expect(String(El)).toBe('.sc-abc') // usable as a nested selector
    expect(Array.isArray(El.parts)).toBe(true)
  })
})
