import {
  createStyledElement,
  getCss,
  renderStaticStyles,
  __resetSheet,
} from 'just-styled/runtime'

const makeDesc = (className, css) => ({
  component: 'div',
  className,
  css,
  vars: [],
  fallback: () => () => null,
})

beforeEach(() => {
  __resetSheet()
})

describe('sheet without a DOM', () => {
  it('collects registered css in memory', () => {
    createStyledElement(makeDesc('js-aaa', '.js-aaa{color:red;}'))
    createStyledElement(makeDesc('js-bbb', '.js-bbb{color:blue;}'))
    expect(getCss()).toBe('.js-aaa{color:red;}.js-bbb{color:blue;}')
  })

  it('dedupes by className', () => {
    createStyledElement(makeDesc('js-aaa', '.js-aaa{color:red;}'))
    createStyledElement(makeDesc('js-aaa', '.js-aaa{color:red;}'))
    expect(getCss()).toBe('.js-aaa{color:red;}')
  })

  it('renderStaticStyles wraps the css in a style tag for SSR', () => {
    createStyledElement(makeDesc('js-aaa', '.js-aaa{color:red;}'))
    expect(renderStaticStyles()).toBe(
      '<style data-just-styled>.js-aaa{color:red;}</style>'
    )
  })

  it('resets cleanly for the next test', () => {
    createStyledElement(makeDesc('js-aaa', '.js-aaa{color:red;}'))
    __resetSheet()
    expect(getCss()).toBe('')
    expect(renderStaticStyles()).toBe('<style data-just-styled></style>')
  })
})
