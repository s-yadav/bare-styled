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
    sheet.registerRule('js-aaa', '.js-aaa{color:red;}')
    sheet.registerRule('js-bbb', '.js-bbb{color:blue;}')
    expect(document.head.querySelectorAll('style[data-just-styled]')).toHaveLength(1)
    expect(tag().sheet.cssRules).toHaveLength(2)
    expect(domCss()).toContain('.js-aaa{color:red;}')
    expect(domCss()).toContain('.js-bbb{color:blue;}')
  })

  it('dedupes rules by className', () => {
    sheet.registerRule('js-aaa', '.js-aaa{color:red;}')
    sheet.registerRule('js-aaa', '.js-aaa{color:red;}')
    expect(tag().sheet.cssRules).toHaveLength(1)
    expect(sheet.getCss()).toBe('.js-aaa{color:red;}')
  })

  it('splits a multi-rule css string into separate CSSOM rules', () => {
    sheet.registerRule('js-h', '.js-h{color:red;}.js-h:hover{color:blue;}')
    expect(tag().sheet.cssRules).toHaveLength(2)
  })

  it('re-creates the tag after a reset', () => {
    sheet.registerRule('js-aaa', '.js-aaa{color:red;}')
    sheet.__resetSheet()
    expect(tag()).toBeNull()
    sheet.registerRule('js-bbb', '.js-bbb{color:blue;}')
    expect(domCss()).toContain('.js-bbb{color:blue;}')
  })
})
