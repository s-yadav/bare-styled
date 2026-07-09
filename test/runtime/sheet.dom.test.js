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

  it('accepts a pre-split rules array (engine rulesheet output)', () => {
    sheet.registerRule(0, 'js-arr', ['.js-arr{color:red;}', '.js-arr:hover{color:blue;}'])
    expect(tag().sheet.cssRules).toHaveLength(2)
    expect(sheet.getCss()).toBe('.js-arr{color:red;}.js-arr:hover{color:blue;}')
  })

  it('does not split on braces inside quoted strings (content:"}")', () => {
    sheet.registerRule(0, 'js-q', '.js-q{content:"}";}.js-q2{color:red;}')
    expect(tag().sheet.cssRules).toHaveLength(2)
    expect(domCss()).toContain('.js-q2{color:red;}')
  })

  it('sends CSSOM-rejected rules to a SEPARATE fallback element, keeping the main sheet intact', () => {
    sheet.registerRule(0, 'js-ok1', '.js-ok1{color:red;}')
    // one good rule + one the CSSOM rejects, registered together
    sheet.registerRule(0, 'js-mix', ['.js-mix{color:green;}', 'garbage-not-a-rule'])
    sheet.registerRule(0, 'js-ok2', '.js-ok2{color:blue;}')

    // main element: only CSSOM rules, none lost, order preserved
    expect(domCss()).toBe('.js-ok1{color:red;}.js-mix{color:green;}.js-ok2{color:blue;}')
    // main element has NO text content (text would re-parse + wipe the sheet in browsers)
    expect(tag().textContent).toBe('')
    // rejected rule landed in the fallback element as text
    const fb = document.head.querySelector('style[data-just-styled-fallback]')
    expect(fb).not.toBeNull()
    expect(fb.textContent).toBe('garbage-not-a-rule')
    // fallback element is removed on reset too
    sheet.__resetSheet()
    expect(document.head.querySelector('style[data-just-styled-fallback]')).toBeNull()
  })
})
