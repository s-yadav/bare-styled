/** @jest-environment jsdom */
const sheet = require('../../packages/runtime/src/sheet')

beforeEach(() => {
  sheet.__resetSheet()
})

const tag = () => document.head.querySelector('style[data-just-styled]')
const domCss = () => {
  const s = tag().sheet
  let out = ''
  for (let i = 0; i < s.cssRules.length; i++) out += s.cssRules[i].cssText
  return out.replace(/\s+/g, '') // normalize jsdom's cssText spacing
}

describe('sheet in the browser (CSSOM insertRule)', () => {
  it('injects into a single <style data-just-styled> via the CSSOM', () => {
    sheet.registerRule(0, 'js-aaa', '.js-aaa{color:red;}')
    sheet.registerRule(0, 'js-bbb', '.js-bbb{color:blue;}')
    expect(document.head.querySelectorAll('style[data-just-styled]')).toHaveLength(1)
    expect(tag().sheet.cssRules).toHaveLength(2)
    expect(domCss()).toContain('.js-aaa{color:red;}')
    expect(domCss()).toContain('.js-bbb{color:blue;}')
  })

  it('inserts positionally by group even when a higher group registers first', () => {
    sheet.registerRule(2, 'js-hi', '.js-hi{z:2;}')
    sheet.registerRule(0, 'js-lo', '.js-lo{z:0;}')
    sheet.registerRule(1, 'js-mid', '.js-mid{z:1;}')
    // DOM order must be lo, mid, hi (group 0,1,2) regardless of registration order
    expect(domCss()).toBe('.js-lo{z:0;}.js-mid{z:1;}.js-hi{z:2;}')
  })

  it('dedupes rules by className', () => {
    sheet.registerRule(0, 'js-aaa', '.js-aaa{color:red;}')
    sheet.registerRule(0, 'js-aaa', '.js-aaa{color:red;}')
    expect(tag().sheet.cssRules).toHaveLength(1)
    expect(sheet.getCss()).toBe('.js-aaa{color:red;}')
  })

  it('splits a multi-rule css string into separate CSSOM rules', () => {
    sheet.registerRule(0, 'js-h', '.js-h{color:red;}.js-h:hover{color:blue;}')
    expect(tag().sheet.cssRules).toHaveLength(2)
  })

  it('re-creates the tag after a reset', () => {
    sheet.registerRule(0, 'js-aaa', '.js-aaa{color:red;}')
    sheet.__resetSheet()
    expect(tag()).toBeNull()
    sheet.registerRule(0, 'js-bbb', '.js-bbb{color:blue;}')
    expect(domCss()).toContain('.js-bbb{color:blue;}')
  })
})
