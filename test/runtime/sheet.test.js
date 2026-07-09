const sheet = require('../../packages/runtime/src/sheet')

beforeEach(() => {
  sheet.__resetSheet()
})

describe('sheet without a DOM', () => {
  it('collects registered css in group order (not registration order)', () => {
    // register a higher group first — getCss must still emit group 0 before 1
    sheet.registerRule(1, 'js-bbb', '.js-bbb{color:blue;}')
    sheet.registerRule(0, 'js-aaa', '.js-aaa{color:red;}')
    expect(sheet.getCss()).toBe('.js-aaa{color:red;}.js-bbb{color:blue;}')
  })

  it('orders within a group by insertion order', () => {
    sheet.registerRule(0, 'js-a', '.js-a{a:1;}')
    sheet.registerRule(0, 'js-b', '.js-b{b:2;}')
    expect(sheet.getCss()).toBe('.js-a{a:1;}.js-b{b:2;}')
  })

  it('dedupes by className', () => {
    sheet.registerRule(0, 'js-aaa', '.js-aaa{color:red;}')
    sheet.registerRule(0, 'js-aaa', '.js-aaa{color:red;}')
    expect(sheet.getCss()).toBe('.js-aaa{color:red;}')
  })

  it('renderStaticStyles wraps the css in a style tag for SSR', () => {
    sheet.registerRule(0, 'js-aaa', '.js-aaa{color:red;}')
    expect(sheet.renderStaticStyles()).toBe('<style data-just-styled>.js-aaa{color:red;}</style>')
  })

  it('resets cleanly for the next test', () => {
    sheet.registerRule(0, 'js-aaa', '.js-aaa{color:red;}')
    sheet.__resetSheet()
    expect(sheet.getCss()).toBe('')
    expect(sheet.renderStaticStyles()).toBe('<style data-just-styled></style>')
  })
})
