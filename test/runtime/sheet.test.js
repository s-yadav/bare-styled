const sheet = require('../../packages/runtime/src/sheet')

beforeEach(() => {
  sheet.__resetSheet()
})

describe('sheet without a DOM', () => {
  it('collects registered css in memory', () => {
    sheet.registerRule('js-aaa', '.js-aaa{color:red;}')
    sheet.registerRule('js-bbb', '.js-bbb{color:blue;}')
    expect(sheet.getCss()).toBe('.js-aaa{color:red;}.js-bbb{color:blue;}')
  })

  it('dedupes by className', () => {
    sheet.registerRule('js-aaa', '.js-aaa{color:red;}')
    sheet.registerRule('js-aaa', '.js-aaa{color:red;}')
    expect(sheet.getCss()).toBe('.js-aaa{color:red;}')
  })

  it('renderStaticStyles wraps the css in a style tag for SSR', () => {
    sheet.registerRule('js-aaa', '.js-aaa{color:red;}')
    expect(sheet.renderStaticStyles()).toBe('<style data-just-styled>.js-aaa{color:red;}</style>')
  })

  it('resets cleanly for the next test', () => {
    sheet.registerRule('js-aaa', '.js-aaa{color:red;}')
    sheet.__resetSheet()
    expect(sheet.getCss()).toBe('')
    expect(sheet.renderStaticStyles()).toBe('<style data-just-styled></style>')
  })
})
