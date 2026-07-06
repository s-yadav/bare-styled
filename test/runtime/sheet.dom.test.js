/** @jest-environment jsdom */
import {
  createStyledElement,
  getCss,
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

describe('sheet in the browser', () => {
  it('appends a single <style data-just-styled> tag to head', () => {
    createStyledElement(makeDesc('js-aaa', '.js-aaa{color:red;}'))
    createStyledElement(makeDesc('js-bbb', '.js-bbb{color:blue;}'))
    const tags = document.head.querySelectorAll('style[data-just-styled]')
    expect(tags).toHaveLength(1)
    expect(tags[0].textContent).toBe('.js-aaa{color:red;}.js-bbb{color:blue;}')
  })

  it('dedupes rules by className in the DOM too', () => {
    createStyledElement(makeDesc('js-aaa', '.js-aaa{color:red;}'))
    createStyledElement(makeDesc('js-aaa', '.js-aaa{color:red;}'))
    const tag = document.head.querySelector('style[data-just-styled]')
    expect(tag.textContent).toBe('.js-aaa{color:red;}')
    expect(getCss()).toBe('.js-aaa{color:red;}')
  })

  it('re-creates the tag after a reset', () => {
    createStyledElement(makeDesc('js-aaa', '.js-aaa{color:red;}'))
    __resetSheet()
    expect(document.head.querySelector('style[data-just-styled]')).toBeNull()
    createStyledElement(makeDesc('js-bbb', '.js-bbb{color:blue;}'))
    const tag = document.head.querySelector('style[data-just-styled]')
    expect(tag.textContent).toBe('.js-bbb{color:blue;}')
  })
})
