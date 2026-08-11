import { IS_STYLED, createStyled, getCss, __resetSheet } from 'bare-styled/runtime'
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

  it('classFor: per-component cache — same css same class within a component, once', () => {
    const d = { componentId: 'sc-x', group: 0 }
    const a = engine.classFor(d, 'color:red;')
    const a2 = engine.classFor(d, 'color:red;')
    const b = engine.classFor(d, 'color:blue;')
    expect(a).toBe(a2) // same css, same component -> same class, cached
    expect(a).not.toBe(b)
    expect(a).toMatch(/^bs-[a-z0-9]+$/)
    expect((getCss().match(new RegExp('\\.' + a + '\\{', 'g')) || []).length).toBe(1)
    expect(getCss()).toContain('.' + b + '{color:blue;}')
  })

  it('keyframes: injects @keyframes into the sheet and resolves to the name', () => {
    const { keyframes } = require('styled-components')
    const spin = keyframes`from { transform: rotate(0deg); } to { transform: rotate(360deg); }`
    const parts = tag`animation: ${spin} 2s linear infinite;`
    // static after flatten (keyframes object is not a function)
    expect(engine.isStatic(parts)).toBe(true)
    const body = engine.resolveParts(parts, {})
    expect(body).toContain('animation: ' + spin.name + ' 2s linear infinite;')
    expect(getCss()).toContain('@keyframes ' + spin.name)
    expect(getCss()).toContain('rotate(360deg)')
  })

  it('keyframes: duck-typed, so a FOREIGN copy (throwing toString) still injects, and __resetSheet re-injects', () => {
    // Simulates a Keyframes instance from a duplicate styled-components copy:
    // instanceof fails everywhere, toString throws (SC v4+ behavior).
    const foreign = {
      name: 'kfforeign1',
      rules: '0%{opacity:0;}100%{opacity:1;}',
      getName: function () { return this.name },
      toString: function () { throw new Error('untagged string interpolation') },
    }
    expect(engine.resolveParts([foreign], {})).toBe('kfforeign1')
    expect(getCss()).toContain('@keyframes kfforeign1')
    __resetSheet()
    expect(getCss()).toBe('')
    expect(engine.resolveParts([foreign], {})).toBe('kfforeign1')
    expect(getCss()).toContain('@keyframes kfforeign1') // re-injected after reset
  })

  it('cacheParts: falls back to a naive interleave when css() throws (cross-copy safety)', () => {
    const bomb = {
      name: 'kfbomb',
      rules: '0%{opacity:0;}',
      getName: function () { return this.name },
      toString: function () { throw new Error('boom') },
    }
    // Force the scCss path to throw by making the interpolation a Proxy that
    // throws on any coercion attempt inside styled-components' flatten? Not
    // needed: real SC only throws cross-copy. Instead call cacheParts with a
    // strings array and verify the fallback shape directly via a throwing css:
    // we simulate by passing a template whose interpolation styled-components
    // itself cannot flatten without toString — the foreign keyframes object is
    // kept as-is by our SAME-copy css() (instanceof miss -> toString throw is
    // exactly the cross-copy case), so cacheParts must not crash.
    const parts = engine.cacheParts(['animation: ', ' 1s;'], [bomb])
    expect(Array.isArray(parts)).toBe(true)
    const body = engine.resolveParts(parts, {})
    expect(body).toContain('animation: kfbomb 1s;')
  })

  it('flat dynamic bodies skip stylis but produce the same rule', () => {
    const d = { componentId: 'sc-flat', group: 0 }
    engine.classFor(d, 'color:tomato;padding:4px;') // flat -> fast path
    const d2 = { componentId: 'sc-nest', group: 0 }
    engine.classFor(d2, 'color:red;&:hover{color:blue;}') // nested -> stylis
    expect(getCss()).toContain('{color:tomato;padding:4px;}')
    expect(getCss()).toContain(':hover{color:blue;}')
  })

  it('does not vendor-prefix by default; setVendorPrefixes(true) opts in', () => {
    const d = { componentId: 'sc-vp', group: 0 }
    engine.classFor(d, 'display:flex;')
    expect(getCss()).toContain('{display:flex;}')
    expect(getCss()).not.toContain('-webkit-')

    engine.setVendorPrefixes(true)
    try {
      __resetSheet()
      const d2 = { componentId: 'sc-vp2', group: 0 }
      engine.classFor(d2, 'display:flex;')
      expect(getCss()).toContain('-webkit-')
    } finally {
      engine.setVendorPrefixes(false)
    }
  })

  it('classFor: per-component hashing — different components, same css -> DIFFERENT classes', () => {
    // (No cross-component dedup: each rule belongs to one component/group so the
    // sheet can order it. Matches styled-components.)
    const x = { componentId: 'sc-x', group: 0 }
    const y = { componentId: 'sc-y', group: 1 }
    expect(engine.classFor(x, 'color:red;')).not.toBe(engine.classFor(y, 'color:red;'))
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

  it('statics passthrough: styled(Dropdown) exposes Dropdown.Item (compound components)', () => {
    function Dropdown(props) { return null }
    Dropdown.Item = function Item(props) { return null }
    Dropdown.defaultProps = { open: false }
    Dropdown.customStatic = 42

    const StyledDropdown = createStyled(Dropdown, { componentId: 'sc-dd' })`color: red;`
    expect(StyledDropdown.Item).toBe(Dropdown.Item)
    expect(StyledDropdown.defaultProps).toBe(Dropdown.defaultProps)
    expect(StyledDropdown.customStatic).toBe(42)
    // own fields shadow the base — nothing leaks the wrong way
    expect(StyledDropdown.componentId).toBe('sc-dd')
    expect(StyledDropdown[IS_STYLED]).toBe(StyledDropdown)
    expect(String(StyledDropdown)).toBe('.sc-dd')
  })

  it('statics passthrough: base with NON-WRITABLE toString (real SC component) must not throw', () => {
    // styled-components v6 defines toString on its components as non-writable.
    // In strict mode, assigning `element.toString = ...` THROUGH a prototype
    // chain holding a read-only property throws — so the proto link must come
    // after the own-field assignments. Use a real SC component as the base,
    // exactly the prophecy shape (styled(RealSCComponent)).
    const styled = require('styled-components').default
    const SCBase = styled.div`color: red;`
    expect(Object.getOwnPropertyDescriptor(SCBase, 'toString').writable).toBe(false)

    SCBase.customStatic = 42

    const Wrapped = createStyled(SCBase, { componentId: 'sc-wrap' })`padding: 4px;`
    expect(String(Wrapped)).toBe('.sc-wrap') // own toString shadows the read-only one
    expect(Wrapped[IS_STYLED]).toBe(Wrapped)
    expect(Wrapped.componentId).toBe('sc-wrap')
    // own fold-contract fields shadow the base's (attrs/foldedComponentIds/componentStyle)
    expect(Wrapped.styledComponentId).toBe('sc-wrap')
    expect(Wrapped.attrs).toEqual([]) // OUR fold contract, not the base's attrs
    expect(typeof Wrapped.componentStyle.generateAndInjectStyles).toBe('function')
    // non-contract statics still flow through the proto link
    expect(Wrapped.customStatic).toBe(42)
  })

  it('_gen/_regGen are OWN properties, never inherited through the prototype link', () => {
    // Regression for the base/extender cache-collision bug: the prototype
    // link (for statics passthrough) must not let an extender's _gen/_regGen
    // read fall through to the base's — that read decides whether the
    // extender creates its OWN style-class cache Map, or ends up reading and
    // MUTATING the base's shared one (colliding with sibling extenders).
    const Base = createStyled('div', { componentId: 'sc-own-base' })`color: red;`
    const Ext = createStyled(Base, { componentId: 'sc-own-ext' })`padding: 4px;`
    expect(Object.prototype.hasOwnProperty.call(Ext, '_gen')).toBe(true)
    expect(Object.prototype.hasOwnProperty.call(Ext, '_regGen')).toBe(true)
    expect(Object.prototype.hasOwnProperty.call(Base, '_gen')).toBe(true)
    expect(Object.prototype.hasOwnProperty.call(Base, '_regGen')).toBe(true)
  })

  it('statics passthrough survives descriptor-over-descriptor chains', () => {
    function Dropdown(props) { return null }
    Dropdown.Item = function Item(props) { return null }

    const A = createStyled(Dropdown, { componentId: 'sc-a' })`color: red;`
    const B = createStyled(A, { componentId: 'sc-b' })`padding: 4px;`
    expect(B.Item).toBe(Dropdown.Item) // falls through two links
    // every level keeps its own identity and fields
    expect(B[IS_STYLED]).toBe(B)
    expect(A[IS_STYLED]).toBe(A)
    expect(B.componentId).toBe('sc-b')
    expect(B.component).toBe(A)
    expect(B.isStatic).toBe(true)
    expect(String(B)).toBe('.sc-b')
  })
})

