import {
  IS_STYLED,
  createStyledElement,
  getCss,
  __resetSheet,
} from 'just-styled/runtime'

const makeDesc = overrides => ({
  component: 'button',
  className: 'js-1a2b3c',
  css: '.js-1a2b3c{color:var(--sc-abc-0-0);font-size:14px;}',
  vars: [['--sc-abc-0-0', props => props.color]],
  displayName: 'Button',
  componentId: 'sc-abc-0',
  fallback: () => () => null,
  ...overrides,
})

beforeEach(() => {
  __resetSheet()
})

describe('createStyledElement', () => {
  it('returns a descriptor with the documented shape', () => {
    const el = createStyledElement(makeDesc())
    // Self-reference discriminator (hoisting-proof): a genuine descriptor's
    // IS_STYLED points at itself.
    expect(el[IS_STYLED]).toBe(el)
    expect(el.component).toBe('button')
    expect(el.className).toBe('js-1a2b3c')
    expect(el.componentId).toBe('sc-abc-0')
    expect(el.displayName).toBe('Button')
    expect(el.getStyle()).toBe('.js-1a2b3c{color:var(--sc-abc-0-0);font-size:14px;}')
  })

  it('uses the shared symbol registry for IS_STYLED', () => {
    expect(IS_STYLED).toBe(Symbol.for('just-styled'))
  })

  it('toString renders the selector for css interpolation', () => {
    const el = createStyledElement(makeDesc())
    expect(String(el)).toBe('.js-1a2b3c')
    expect(`${el}:hover`).toBe('.js-1a2b3c:hover')
  })

  describe('getInlineStyles', () => {
    it('maps var functions over props', () => {
      const el = createStyledElement(makeDesc())
      expect(el.getInlineStyles({ color: 'red' })).toEqual({
        '--sc-abc-0-0': 'red',
      })
    })

    it('skips null, undefined and false results', () => {
      const el = createStyledElement(
        makeDesc({
          vars: [
            ['--a', () => null],
            ['--b', () => undefined],
            ['--c', () => false],
            ['--d', () => 'kept'],
          ],
        })
      )
      expect(el.getInlineStyles({})).toEqual({ '--d': 'kept' })
    })

    it('keeps numbers as numbers and stringifies other values', () => {
      const el = createStyledElement(
        makeDesc({
          vars: [
            ['--n', () => 0],
            ['--s', () => 12],
            ['--t', () => true],
          ],
        })
      )
      expect(el.getInlineStyles({})).toEqual({
        '--n': 0,
        '--s': 12,
        '--t': 'true',
      })
    })

    it('returns an empty object when vars is absent', () => {
      const el = createStyledElement(makeDesc({ vars: undefined }))
      expect(el.getInlineStyles({})).toEqual({})
    })
  })

  describe('getStyledComponent', () => {
    it('memoizes the fallback', () => {
      const fallback = jest.fn(() => ({ tag: 'fake-styled' }))
      const el = createStyledElement(makeDesc({ fallback }))
      expect(fallback).not.toHaveBeenCalled()
      const first = el.getStyledComponent()
      const second = el.getStyledComponent()
      expect(first).toBe(second)
      expect(fallback).toHaveBeenCalledTimes(1)
    })
  })

  it('registers css into the sheet at creation', () => {
    createStyledElement(makeDesc())
    expect(getCss()).toBe('.js-1a2b3c{color:var(--sc-abc-0-0);font-size:14px;}')
  })
})
