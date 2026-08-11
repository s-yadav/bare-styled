/** @jest-environment jsdom */
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import {
  createStyled,
  installCreateElementPatch,
  uninstallCreateElementPatch,
  getCss,
  __resetSheet,
  __getFallbackRenders,
} from 'bare-styled/runtime'

global.IS_REACT_ACT_ENVIRONMENT = true

let container
beforeEach(() => {
  installCreateElementPatch()
  container = document.createElement('div')
  document.body.appendChild(container)
})
afterEach(() => {
  uninstallCreateElementPatch()
  __resetSheet()
  document.head.innerHTML = ''
  document.body.innerHTML = ''
})
const render = el => act(() => createRoot(container).render(el))

describe('descriptor resolution (hash-class, no wrapper fiber)', () => {
  it('a STATIC native-tag descriptor uses just the componentId class (no hash)', () => {
    const Box = createStyled('div', { componentId: 'sc-box' })`color: red;`
    render(React.createElement(Box, null, 'hi'))
    const el = container.querySelector('div')
    expect(el.textContent).toBe('hi')
    expect(el.className).toBe('sc-box') // static -> componentId only, resolved once
    expect(getCss()).toMatch(/\.sc-box\{color:red;\}/)
  })

  it('re-registers a static rule after __resetSheet (descriptor outlives the sheet)', () => {
    // Regression: a module-level descriptor is created once and reused across
    // many sheet resets (e.g. repeated harness runs). A per-descriptor "done"
    // flag would survive the reset and suppress re-registration, leaving the
    // static css missing. The guard must track the sheet's lifetime instead.
    const Box = createStyled('div', { componentId: 'sc-reuse' })`color: green;`
    render(React.createElement(Box, null, '1'))
    expect(getCss()).toMatch(/\.sc-reuse\{color:green;\}/)

    __resetSheet()
    expect(getCss()).not.toContain('sc-reuse') // cleared

    render(React.createElement(Box, null, '2')) // same descriptor, fresh sheet
    expect(getCss()).toMatch(/\.sc-reuse\{color:green;\}/) // back in the DOM
  })

  it('re-registers a build-time precompiled (Opt 2) rule after __resetSheet', () => {
    const Box = createStyled('div', {
      componentId: 'sc-pre',
      css: '.sc-pre{color:teal;}', // plugin build-time serialized rule
    })``
    render(React.createElement(Box, null, 'a'))
    expect(getCss()).toContain('.sc-pre{color:teal;}')
    __resetSheet()
    render(React.createElement(Box, null, 'b'))
    expect(getCss()).toContain('.sc-pre{color:teal;}')
  })

  it('distinct resolved styles get distinct classes; identical ones share', () => {
    const Btn = createStyled('button', { componentId: 'sc-b' })`color: ${p => p.color};`
    render(React.createElement('div', null,
      React.createElement(Btn, { color: 'red', key: 1 }, 'a'),
      React.createElement(Btn, { color: 'blue', key: 2 }, 'b'),
      React.createElement(Btn, { color: 'red', key: 3 }, 'c')))
    const cls = [...container.querySelectorAll('button')].map(b => b.className.split(' ')[1])
    expect(cls[0]).toBe(cls[2]) // same color -> same class
    expect(cls[0]).not.toBe(cls[1])
  })

  it('filters non-DOM props on native tags, keeps className/style/handlers', () => {
    const Box = createStyled('div', { componentId: 'sc-f' })`color: red;`
    render(React.createElement(Box, { variant: 'x', className: 'user', style: { margin: 1 } }, 'y'))
    const el = container.querySelector('div')
    expect(el.hasAttribute('variant')).toBe(false)
    expect(el.className).toMatch(/\buser\b/)
    expect(el.style.margin).toBe('1px')
  })

  it('styled(Component) forwards the (dynamic) class to the wrapped component (no token)', () => {
    function Inner({ className }) { return React.createElement('span', { id: 'leaf', className }) }
    const Wrapped = createStyled(Inner, { componentId: 'sc-w' })`background: ${p => p.color};`
    render(React.createElement(Wrapped, { color: 'red' }))
    const leaf = container.querySelector('#leaf')
    expect(leaf.className).toMatch(/^sc-w bs-[a-z0-9]+$/) // dynamic -> componentId + hash
    expect(leaf.className).not.toContain('inline')
  })

  it('`as` renders a different tag', () => {
    const Box = createStyled('div', { componentId: 'sc-as' })`color: red;`
    render(React.createElement(Box, { as: 'section' }, 'z'))
    expect(container.querySelector('section')).not.toBeNull()
    expect(container.querySelector('div')).toBeNull()
  })

  it('does not bail: every styled render is a plain host element', () => {
    // (previously "block interpolation" would bail to styled-components)
    const Box = createStyled('div', { componentId: 'sc-nb' })`${p => (p.on ? 'background: gray;' : '')}color: red;`
    render(React.createElement(Box, { on: true }, 'q'))
    const el = container.querySelector('div')
    expect(el.className).toMatch(/^sc-nb bs-[a-z0-9]+$/)
    expect(getCss()).toMatch(/background:\s*gray/)
  })
})

describe('skeleton mode (build-compiled structure, render = substitution)', () => {
  const SKEL = '.__bsc__{color:var(--bs-0);}.__bsc__:hover{background:var(--bs-1);}'

  it('renders nested skeletons with per-variant classes — no stylis at render', () => {
    const Box = createStyled('div', {
      componentId: 'sc-sk1',
      skeleton: SKEL,
      vars: [p => p.c, p => p.bg],
    })``
    render(React.createElement(Box, { c: 'red', bg: 'blue' }, 'x'))
    const el = container.querySelector('div')
    const js = (el.className.match(/bs-[a-z0-9]+/) || [])[0]
    expect(el.className).toBe('sc-sk1 ' + js)
    expect(getCss()).toContain('.' + js + '{color:red;}')
    expect(getCss()).toContain('.' + js + ':hover{background:blue;}') // structure from BUILD
  })

  it('same values -> same class (short-key cache); different values -> new variant', () => {
    const Box = createStyled('div', { componentId: 'sc-sk2', skeleton: '.__bsc__{color:var(--bs-0);}', vars: [p => p.c] })``
    render(React.createElement('div', null,
      React.createElement(Box, { c: 'red', key: 1 }),
      React.createElement(Box, { c: 'red', key: 2 }),
      React.createElement(Box, { c: 'teal', key: 3 })))
    const classes = [...container.querySelectorAll('.sc-sk2')].map(e => (e.className.match(/bs-[a-z0-9]+/) || [])[0])
    expect(classes[0]).toBe(classes[1])
    expect(classes[0]).not.toBe(classes[2])
    expect((getCss().match(/color:red/g) || []).length).toBe(1) // one rule for the pair
  })

  it('falsy values become empty declarations; the rest of the rule survives', () => {
    const Box = createStyled('div', { componentId: 'sc-sk3', skeleton: '.__bsc__{background:var(--bs-0);color:teal;}', vars: [p => p.bg] })``
    render(React.createElement(Box, null, 'x'))
    expect(getCss()).toMatch(/color:teal/)
  })

  it('brace guard: a value containing braces renormalizes through stylis (live-path parity)', () => {
    // Matching styled-components semantics: a brace-bearing value can open a
    // sibling rule (sanitization is the app's job, as with SC) — but the
    // output must be WELL-FORMED (stylis renormalized, never raw-substituted),
    // and the component's own rule must survive intact.
    const Box = createStyled('div', { componentId: 'sc-sk4', skeleton: '.__bsc__{color:var(--bs-0);}', vars: [p => p.c] })``
    render(React.createElement(Box, { c: 'red;} .other{background:pink' }, 'x'))
    const js = (container.querySelector('div').className.match(/bs-[a-z0-9]+/) || [])[0]
    expect(getCss()).toContain('.' + js + '{color:red;}') // main rule intact
    expect(getCss()).toContain('.other{background:pink;}') // renormalized: properly terminated
    // and the CSSOM accepted everything (nothing fell to the text fallback)
    expect(document.head.querySelector('style[data-bare-styled-fallback]')).toBeNull()
  })

  it('non-function vars substitute at definition; zero fns promotes to fully static', () => {
    const spin = { name: 'kfsk', rules: '0%{opacity:0;}', getName() { return this.name } } // keyframes duck
    const Box = createStyled('div', {
      componentId: 'sc-sk5',
      skeleton: '.__bsc__{animation:var(--bs-0) 1s;color:var(--bs-1);}',
      vars: [spin, 'teal'],
    })``
    expect(Box.isStatic).toBe(true) // promoted — no render-time work at all
    render(React.createElement(Box, null, 'x'))
    expect(container.querySelector('div').className).toBe('sc-sk5')
    expect(getCss()).toContain('.sc-sk5{animation:kfsk 1s;color:teal;}')
    expect(getCss()).toContain('@keyframes kfsk') // injected during substitution
  })

  it('mixed vars: statics substitute once, fns renumber and resolve per render', () => {
    const Box = createStyled('div', {
      componentId: 'sc-sk6',
      skeleton: '.__bsc__{border:1px solid var(--bs-0);color:var(--bs-1);}',
      vars: ['#eee', p => p.c],
    })``
    expect(Box.isStatic).toBe(false)
    render(React.createElement(Box, { c: 'red' }, 'x'))
    const js = (container.querySelector('div').className.match(/bs-[a-z0-9]+/) || [])[0]
    expect(getCss()).toContain('.' + js + '{border:1px solid #eee;color:red;}')
  })
})

describe('cache collision regression (sibling extenders of a rendered base)', () => {
  // Bug: extenders link to their base via Object.setPrototypeOf for statics
  // passthrough. The style-class cache guard reads `descriptor._gen` — if an
  // extender has no OWN `_gen`, that read falls through the prototype chain
  // to the base's. Once the base itself has rendered (stamping ITS OWN _gen
  // at the current sheet generation), every extender's inherited read already
  // matches, so the guard never creates the extender's own cache Map and
  // instead mutates the BASE's shared Map. Two unrelated sibling extenders
  // that resolve to the same cache key then steal each other's class — e.g. a
  // full-width card rendering with a small radio button's styles. The fix
  // (packages/runtime/src/index.js) stamps `_gen`/`_regGen` as OWN properties
  // on every descriptor before the prototype link is made.

  it('classFor: siblings with an identical resolved css body still get their own class + rule', () => {
    // Base is itself dynamic so it seeds ITS OWN _gen/_cache at the current
    // sheet generation before Card/Radio ever run — the exact precondition
    // for the collision. A single render mounts all three so the base
    // resolves (top-down) before its two extenders.
    const Base = createStyled('div', { componentId: 'sc-cc-base' })`opacity: ${p => p.o};`
    const Card = createStyled(Base, { componentId: 'sc-cc-card' })`width: ${p => p.w};`
    const Radio = createStyled(Base, { componentId: 'sc-cc-radio' })`width: ${p => p.w};`
    // Same resolved css body ("width: 20px;") on both siblings — the shared-cache
    // key that used to collide.
    render(React.createElement('div', null,
      React.createElement(Base, { o: 1, key: 0 }, 'base'),
      React.createElement(Card, { w: '20px', key: 1 }, 'card'),
      React.createElement(Radio, { w: '20px', key: 2 }, 'radio')))

    // className is the full chain (base's own class + the extender's own),
    // since styled(StyledComponent) keeps both rules — the extender's own
    // componentId/hash pair are always the LAST two tokens.
    const cardTokens = container.querySelector('.sc-cc-card').className.split(' ')
    const radioTokens = container.querySelector('.sc-cc-radio').className.split(' ')
    const cardCls = cardTokens[cardTokens.length - 1]
    const radioCls = radioTokens[radioTokens.length - 1]
    expect(cardTokens[cardTokens.length - 2]).toBe('sc-cc-card')
    expect(radioTokens[radioTokens.length - 2]).toBe('sc-cc-radio')
    expect(cardCls).not.toBe(radioCls) // neither stole the other's cached class
    expect(getCss()).toContain('.' + cardCls + '{width: 20px;}')
    expect(getCss()).toContain('.' + radioCls + '{width: 20px;}')
  })

  it('classForVars (skeleton mode): siblings with identical values resolve their OWN structure, not each other\'s', () => {
    const Base = createStyled('div', {
      componentId: 'sc-cc-base2',
      skeleton: '.__bsc__{opacity:var(--bs-0);}',
      vars: [p => p.o],
    })``
    // Structurally very different siblings (full-width card vs. tiny radio dot)
    // that happen to resolve the SAME interpolated value ("blue") — exactly the
    // reported symptom: a card rendering with a radio button's dimensions.
    const Card = createStyled(Base, {
      componentId: 'sc-cc-card2',
      skeleton: '.__bsc__{width:100%;border-color:var(--bs-0);}',
      vars: [p => (p.selected ? 'blue' : 'gray')],
    })``
    const Radio = createStyled(Base, {
      componentId: 'sc-cc-radio2',
      skeleton: '.__bsc__{width:12px;border-color:var(--bs-0);}',
      vars: [p => (p.selected ? 'blue' : 'gray')],
    })``
    render(React.createElement('div', null,
      React.createElement(Base, { o: 1, key: 0 }, 'base'),
      React.createElement(Card, { selected: true, key: 1 }, 'card'),
      React.createElement(Radio, { selected: true, key: 2 }, 'radio')))

    const cardTokens = container.querySelector('.sc-cc-card2').className.split(' ')
    const radioTokens = container.querySelector('.sc-cc-radio2').className.split(' ')
    const cardCls = cardTokens[cardTokens.length - 1]
    const radioCls = radioTokens[radioTokens.length - 1]
    expect(cardTokens[cardTokens.length - 2]).toBe('sc-cc-card2')
    expect(radioTokens[radioTokens.length - 2]).toBe('sc-cc-radio2')
    expect(cardCls).not.toBe(radioCls)
    expect(getCss()).toContain('.' + cardCls + '{width:100%;border-color:blue;}') // card keeps its OWN structure
    expect(getCss()).toContain('.' + radioCls + '{width:12px;border-color:blue;}') // radio keeps its OWN structure
  })
})

describe('native .attrs / .withConfig (styled-components semantics)', () => {
  it('object attrs land on the host; incoming props are overridden by attrs', () => {
    const Field = createStyled('input', { componentId: 'sc-att1', attrs: [{ type: 'text' }] })`border: 1px solid #ccc;`
    render(React.createElement(Field, { type: 'password', defaultValue: 'x' }))
    const el = container.querySelector('input')
    expect(el.getAttribute('type')).toBe('text') // attrs override props (SC v5.1+ semantics)
    expect(el.className).toBe('sc-att1') // attrs don't break the static path
    expect(getCss()).toContain('.sc-att1{border:1px solid #ccc;}')
  })

  it('fn attrs receive the context and feed style interpolations', () => {
    const Sized = createStyled('div', {
      componentId: 'sc-att2',
      attrs: [p => ({ $pad: (p.$pad || 2) * 2 })],
    })`padding: ${p => p.$pad}px;`
    render(React.createElement(Sized, { $pad: 4 }, 'x'))
    expect(getCss()).toContain('padding: 8px;') // interpolation saw the attr-resolved value
  })

  it('className joins and style merges instead of overriding', () => {
    const Boxy = createStyled('div', {
      componentId: 'sc-att3',
      attrs: [{ className: 'from-attrs', style: { margin: '1px' } }],
    })`color: red;`
    render(React.createElement(Boxy, { className: 'from-props', style: { top: '2px' } }, 'x'))
    const el = container.querySelector('div')
    expect(el.className).toContain('sc-att3')
    expect(el.className).toContain('from-props')
    expect(el.className).toContain('from-attrs')
    expect(el.style.margin).toBe('1px')
    expect(el.style.top).toBe('2px')
  })

  it('chain attrs apply base-first so the extender overrides (SC folded ordering)', () => {
    const Base = createStyled('a', { componentId: 'sc-att4', attrs: [{ title: 'base', href: '#b' }] })`color: blue;`
    const Ext = createStyled(Base, { componentId: 'sc-att5', attrs: [{ title: 'ext' }] })`font-weight: 600;`
    render(React.createElement(Ext, null, 'x'))
    const el = container.querySelector('a')
    expect(el.getAttribute('title')).toBe('ext') // extender wins
    expect(el.getAttribute('href')).toBe('#b') // base attr survives
    expect(el.className).toContain('sc-att4')
    expect(el.className).toContain('sc-att5')
  })

  it('chained callback attrs see earlier attrs results in their context (SC accumulation)', () => {
    const Acc = createStyled('div', {
      componentId: 'sc-acc',
      attrs: [
        { 'data-step': 'one' },
        ctx => ({ 'data-seen': ctx['data-step'] }), // sees the object attr's result
        ctx => ({ 'data-final': ctx['data-seen'] + '-two' }), // sees the previous callback's result
      ],
    })`color: red;`
    render(React.createElement(Acc, null, 'x'))
    const el = container.querySelector('div')
    expect(el.getAttribute('data-seen')).toBe('one')
    expect(el.getAttribute('data-final')).toBe('one-two')
  })

  it('callback attrs OVERRIDE incoming props for the same key (SC v5.1+ semantics)', () => {
    const Btn = createStyled('button', {
      componentId: 'sc-fnov',
      attrs: [p => ({ type: p.$submit ? 'submit' : 'button' })],
    })`padding: 2px;`
    render(React.createElement(Btn, { type: 'reset', $submit: true }, 'x'))
    expect(container.querySelector('button').getAttribute('type')).toBe('submit')
  })

  it('a throwing callback attr (e.g. context theme access) is dropped, rest still applies', () => {
    const Risky = createStyled('div', {
      componentId: 'sc-boom',
      attrs: [
        p => ({ role: p.theme.mode }), // props.theme is undefined -> throws
        { 'data-safe': 'yes' },
      ],
    })`color: red;`
    render(React.createElement(Risky, null, 'x'))
    const el = container.querySelector('div')
    expect(el.hasAttribute('role')).toBe(false) // throwing attr dropped
    expect(el.getAttribute('data-safe')).toBe('yes') // later attr unaffected
    expect(el.className).toBe('sc-boom') // component still renders + styles
    expect(getCss()).toContain('.sc-boom{color:red;}')
  })

  it('withConfig shouldForwardProp replaces the default prop filter', () => {
    const Item = createStyled('div', {
      componentId: 'sc-sfp',
      shouldForwardProp: prop => !['disabled', 'danger'].includes(prop),
    })`color: ${p => (p.danger ? 'red' : 'black')};`
    render(React.createElement(Item, { danger: true, title: 'kept' }, 'x'))
    const el = container.querySelector('div')
    expect(el.hasAttribute('danger')).toBe(false) // filtered by the custom fn
    expect(el.getAttribute('title')).toBe('kept')
    expect(getCss()).toMatch(/color:\s*red/)
  })

  it('runtime factory is chainable: .attrs(...).withConfig(...)``', () => {
    const Btn = createStyled('button', { componentId: 'sc-will-be-overridden' })
      .attrs({ type: 'button' })
      .withConfig({ componentId: 'sc-chained' })`padding: 2px;`
    render(React.createElement(Btn, null, 'x'))
    const el = container.querySelector('button')
    expect(el.getAttribute('type')).toBe('button')
    expect(el.className).toBe('sc-chained')
    expect(getCss()).toContain('.sc-chained{padding:2px;}')
  })
})

describe('shouldForwardProp (withConfig) — full semantics', () => {
  it('receives (prop, target) and REPLACES the default filter (not layered on it)', () => {
    const seen = []
    const Box = createStyled('section', {
      componentId: 'sc-sfp1',
      shouldForwardProp: (prop, target) => {
        seen.push([prop, target])
        return prop !== 'blocked'
      },
    })`color: red;`
    render(React.createElement(Box, { blocked: 'x', customattr: 'kept', title: 'ok' }, 'y'))
    const el = container.querySelector('section')
    expect(el.hasAttribute('blocked')).toBe(false) // filtered by the custom fn
    // a prop the DEFAULT filter (@emotion/is-prop-valid) would DROP is kept,
    // because a custom fn fully decides — styled-components semantics
    expect(el.getAttribute('customattr')).toBe('kept')
    expect(el.getAttribute('title')).toBe('ok')
    expect(seen.some(([p, t]) => p === 'customattr' && t === 'section')).toBe(true) // target passed
  })

  it('className / style / children stay managed even when sfp rejects everything', () => {
    const Box = createStyled('div', { componentId: 'sc-sfp2', shouldForwardProp: () => false })`color: red;`
    render(React.createElement(Box, { className: 'user', style: { top: '1px' }, anything: 'dropped' }, 'kid'))
    const el = container.querySelector('div')
    expect(el.className).toContain('sc-sfp2')
    expect(el.className).toContain('user')
    expect(el.style.top).toBe('1px')
    expect(el.textContent).toBe('kid')
    expect(el.hasAttribute('anything')).toBe(false)
  })

  it('`as` is consumed before sfp ever sees it, and still switches the tag', () => {
    const calls = []
    const Box = createStyled('div', {
      componentId: 'sc-sfp3',
      shouldForwardProp: p => {
        calls.push(p)
        return true
      },
    })`color: red;`
    render(React.createElement(Box, { as: 'aside', title: 't' }, 'x'))
    expect(container.querySelector('aside')).not.toBeNull()
    expect(calls).not.toContain('as')
  })

  it('extension chains: extender inherits the base sfp (SC folded semantics)', () => {
    const Base = createStyled('div', { componentId: 'sc-sfpb', shouldForwardProp: p => p !== 'hidea' })`color: red;`
    const Ext = createStyled(Base, { componentId: 'sc-sfpe' })`padding: 1px;`
    render(React.createElement(Ext, { hidea: '1', title: 'kept' }, 'x'))
    const el = container.querySelector('div')
    expect(el.hasAttribute('hidea')).toBe(false) // base's filter applied via inheritance
    expect(el.getAttribute('title')).toBe('kept')
  })

  it("extension chains: the extender's OWN sfp fully replaces the inherited one", () => {
    const Base = createStyled('div', { componentId: 'sc-sfpb2', shouldForwardProp: p => p !== 'hidea' })`color: red;`
    const Ext = createStyled(Base, { componentId: 'sc-sfpe2', shouldForwardProp: p => p !== 'hideb' })`margin: 1px;`
    render(React.createElement(Ext, { hidea: 'now-kept', hideb: 'x' }, 'y'))
    const el = container.querySelector('div')
    expect(el.hasAttribute('hideb')).toBe(false) // extender's filter
    expect(el.getAttribute('hidea')).toBe('now-kept') // base's filter NOT layered on top
  })

  it('attrs-produced props are filtered through sfp too', () => {
    const Field = createStyled('input', {
      componentId: 'sc-sfp4',
      attrs: [{ type: 'text', secret: 'x' }],
      shouldForwardProp: p => p !== 'secret',
    })`color: red;`
    render(React.createElement(Field))
    const el = container.querySelector('input')
    expect(el.getAttribute('type')).toBe('text') // attr kept by sfp
    expect(el.hasAttribute('secret')).toBe(false) // attr rejected by sfp
  })

  it('works through the runtime chainable factory', () => {
    const Box = createStyled('div', { componentId: 'sc-tmp' })
      .withConfig({ componentId: 'sc-sfp5', shouldForwardProp: p => p !== 'nope' })`color: blue;`
    render(React.createElement(Box, { nope: '1', title: 'yes' }, 'x'))
    const el = container.querySelector('div')
    expect(el.className).toBe('sc-sfp5')
    expect(el.hasAttribute('nope')).toBe(false)
    expect(el.getAttribute('title')).toBe('yes')
  })
})

describe('forwardProps (withConfig) — one-call prop shaping', () => {
  it('the returned object IS the element props; styles still see the original context', () => {
    const Stack = createStyled('div', {
      componentId: 'sc-fp1',
      forwardProps: ({ gap, align, ...rest }) => rest, // the Layout-component pattern
    })`display: flex; gap: ${p => p.gap}px; align-items: ${p => p.align};`
    render(React.createElement(Stack, { gap: 8, align: 'center', title: 'kept' }, 'x'))
    const el = container.querySelector('div')
    expect(el.hasAttribute('gap')).toBe(false) // stripped from the DOM
    expect(el.hasAttribute('align')).toBe(false)
    expect(el.getAttribute('title')).toBe('kept')
    expect(getCss()).toContain('gap: 8px') // ...but styles resolved from the ORIGINAL props
    expect(getCss()).toMatch(/align-items:\s*center/)
  })

  it('replaces the default filter entirely — whatever it returns is forwarded', () => {
    const Box = createStyled('i', {
      componentId: 'sc-fp2',
      forwardProps: () => ({ customattr: 'yes' }), // default filter would drop this
    })`color: red;`
    render(React.createElement(Box, { title: 'gone-too' }, 'x'))
    const el = container.querySelector('i')
    expect(el.getAttribute('customattr')).toBe('yes')
    expect(el.hasAttribute('title')).toBe(false) // not in the returned shape
  })

  it('children always come from the original element — the shape cannot lose or replace them', () => {
    const Keep = createStyled('div', { componentId: 'sc-fp3', forwardProps: ({ $x, ...rest }) => rest })`color: red;`
    render(React.createElement(Keep, { $x: 1 }, 'kept-kid'))
    expect(container.querySelector('div').textContent).toBe('kept-kid')

    // a children key in the shape is IGNORED (forwardProps shapes attributes;
    // consistent between the jsx runtime and the createElement patch)
    const Drop = createStyled('span', { componentId: 'sc-fp4', forwardProps: () => ({ children: 'ignored' }) })`color: red;`
    render(React.createElement(Drop, null, 'original'))
    expect(container.querySelector('span').textContent).toBe('original')
  })

  it('className from the shape merges after our generated classes; `as` still works', () => {
    const Box = createStyled('div', {
      componentId: 'sc-fp5',
      forwardProps: p => ({ className: p.$extra }),
    })`color: ${p => p.$c};`
    render(React.createElement(Box, { as: 'nav', $c: 'red', $extra: 'user-cls' }, 'x'))
    const el = container.querySelector('nav') // `as` consumed before shaping
    expect(el).not.toBeNull()
    expect(el.className).toMatch(/^sc-fp5 bs-[a-z0-9]+ user-cls$/)
  })

  it('takes precedence over shouldForwardProp when both are configured', () => {
    const Box = createStyled('div', {
      componentId: 'sc-fp6',
      shouldForwardProp: () => true, // would forward everything
      forwardProps: ({ secret, ...rest }) => rest, // wins
    })`color: red;`
    render(React.createElement(Box, { secret: 'x', title: 'ok' }, 'y'))
    const el = container.querySelector('div')
    expect(el.hasAttribute('secret')).toBe(false)
    expect(el.getAttribute('title')).toBe('ok')
  })

  it('applies ONCE at the final target; intermediate chain templates see full props', () => {
    const Base = createStyled('div', { componentId: 'sc-fp7' })`padding: ${p => p.$pad}px;`
    const Ext = createStyled(Base, {
      componentId: 'sc-fp8',
      forwardProps: ({ $pad, $tint, ...rest }) => rest,
    })`color: ${p => p.$tint};`
    render(React.createElement(Ext, { $pad: 6, $tint: 'teal', title: 'kept' }, 'x'))
    const el = container.querySelector('div')
    expect(el.hasAttribute('$pad')).toBe(false)
    expect(el.getAttribute('title')).toBe('kept')
    expect(getCss()).toContain('padding: 6px') // BASE template still saw $pad
    expect(getCss()).toMatch(/color:\s*teal/) // extender template saw $tint
  })

  it('attrs feed the shaping fn (post-attrs context)', () => {
    const Field = createStyled('input', {
      componentId: 'sc-fp9',
      attrs: [{ type: 'text', $meta: 'internal' }],
      forwardProps: ({ $meta, ...rest }) => rest,
    })`color: red;`
    render(React.createElement(Field))
    const el = container.querySelector('input')
    expect(el.getAttribute('type')).toBe('text') // attr survived shaping
    expect(el.hasAttribute('$meta')).toBe(false) // attr stripped by shaping
  })

  it('works through the runtime chainable factory', () => {
    const Box = createStyled('div', { componentId: 'sc-fp10' })
      .withConfig({ forwardProps: ({ $x, ...rest }) => rest })`color: red;`
    render(React.createElement(Box, { $x: 1, title: 'ok' }, 'y'))
    const el = container.querySelector('div')
    expect(el.hasAttribute('$x')).toBe(false)
    expect(el.getAttribute('title')).toBe('ok')
  })
})

describe('forwardRef fallback detection (fiber-win diagnostics)', () => {
  it('unintercepted render pays a fiber: counter increments and warns once per component', () => {
    uninstallCreateElementPatch() // simulate a missed interception
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const Box = createStyled('div', { componentId: 'sc-fb', displayName: 'FbBox' })`color: red;`
      const before = __getFallbackRenders()
      // Raw, unpatched createElement: the descriptor reaches React as a TYPE,
      // so the forwardRef body must run (wrapper fiber) — for both instances.
      render(React.createElement('div', null, React.createElement(Box, { key: 1 }), React.createElement(Box, { key: 2 })))
      expect(container.querySelectorAll('.sc-fb')).toHaveLength(2) // still renders correctly
      expect(__getFallbackRenders()).toBe(before + 2) // each fallback render counted
      const ours = warn.mock.calls.filter(c => String(c[0]).includes('[bare-styled]'))
      expect(ours).toHaveLength(1) // warned once per component, not per render
      expect(String(ours[0][0])).toContain('FbBox')
    } finally {
      warn.mockRestore()
    }
  })

  it('intercepted render pays nothing: counter unchanged with the patch installed', () => {
    // beforeEach installed the patch
    const Box = createStyled('div', { componentId: 'sc-nofb' })`color: blue;`
    const before = __getFallbackRenders()
    render(React.createElement(Box, null, 'x'))
    expect(container.querySelector('.sc-nofb')).not.toBeNull()
    expect(__getFallbackRenders()).toBe(before) // resolved at creation — no fiber
  })
})

