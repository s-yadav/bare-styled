import { transformSync } from '@babel/core'
import path from 'path'
import plugin from '../src/js-transform'

const run = (code, opts = {}) =>
  transformSync(code, {
    filename: path.join(__dirname, 'Sample.jsx'),
    babelrc: false,
    configFile: false,
    plugins: [[plugin, opts]],
  }).code

describe('js-transform (decoupled createStyled emit)', () => {
  it('rewrites styled.tag: statics resolved, value-position fns become skeleton vars', () => {
    const out = run(`
      import styled from 'styled-components'
      const theme = { bg: 'red' }
      const Card = styled.div\`
        width: 400px;
        background: \${theme.bg};
        color: \${props => props.color};
      \`
    `)
    // rewritten to createStyled with component + config
    expect(out).toMatch(/createStyled\)?\("div",\s*\{/)
    expect(out).toMatch(/componentId:\s*"sc-[a-z0-9]+-0"/)
    expect(out).toMatch(/displayName:\s*"Sample__Card"/)
    // module const resolved at build; the prop fn becomes a var slot in a
    // build-compiled skeleton (no stylis at render, ever)
    expect(out).toMatch(/skeleton:\s*"\.__bsc__\{width:400px;background:red;color:var\(--bs-0\);\}"/)
    expect(out).toMatch(/vars:\s*\[props => props\.color\]/)
    // runtime imports injected
    expect(out).toMatch(/from ['"]bare-styled\/runtime['"]/)
    expect(out).toMatch(/bare-styled\/runtime\/patch/)
  })

  it('pre-compiles a zero-interpolation template at build time (Opt 2)', () => {
    const out = run(`
      import styled from 'styled-components'
      const A = styled.div\`color: red; padding: 8px;\`
    `)
    // finished stylis output emitted as css, keyed to the componentId; the live
    // template body is dropped (no runtime stylis for fully-static rules).
    expect(out).toMatch(/css:\s*"\.sc-[a-z0-9]+-0\{color:red;padding:8px;\}"/)
    expect(out).not.toMatch(/`[^`]*color: red/) // no live backtick template left
  })

  it('pre-compiles static-after-flatten templates (module const members) at build time', () => {
    const out = run(`
      import styled from 'styled-components'
      const theme = { border: '#e5e7eb', space: { sm: 8 } }
      const RADIUS = '8px'
      const A = styled.div\`border: 1px solid \${theme.border}; padding: \${theme.space.sm}px; border-radius: \${RADIUS};\`
    `)
    // module constants resolved and baked into the serialized rule at build time
    expect(out).toMatch(/css:\s*"[^"]*border:1px solid #e5e7eb[^"]*padding:8px[^"]*border-radius:8px[^"]*"/)
    expect(out).not.toContain('theme.border') // interpolation resolved away
  })

  it('does NOT pre-compile when an interpolation is prop-dependent', () => {
    const out = run(`
      import styled from 'styled-components'
      const A = styled.div\`color: \${p => p.c};\`
    `)
    expect(out).not.toMatch(/\bcss:/) // left to runtime resolution
    expect(out).toContain('p => p.c')
  })

  it('pre-compiles a fully-static styled(Component) too (rule ordered at runtime, not folded)', () => {
    const out = run(`
      import styled from 'styled-components'
      const B = styled(Base)\`color: red;\`
    `)
    expect(out).toMatch(/createStyled\)?\(Base,/) // still targets the base component
    expect(out).toMatch(/css:\s*"\.sc-[a-z0-9]+-0\{color:red;\}"/) // extender's own rule precompiled
  })

  it('rewrites styled("tag") and styled(Component)', () => {
    const out = run(`
      import styled from 'styled-components'
      const A = styled('input')\`color: red;\`
      const B = styled(Base)\`color: blue;\`
    `)
    expect(out).toMatch(/createStyled\)?\("input",/)
    expect(out).toMatch(/createStyled\)?\(Base,/)
  })

  it('compiles .attrs chains: expressions stay live, in application order, precompile intact', () => {
    const out = run(`
      import styled from 'styled-components'
      const Field = styled.input.attrs({ type: 'text' })\`border: 1px solid #ccc;\`
      const Chained = styled.a.attrs({ href: '#' }).attrs(p => ({ title: p.title || 't' }))\`color: blue;\`
    `)
    expect(out).toMatch(/attrs:\s*\[\{\s*type:\s*'text'\s*\}\]/)
    expect(out).toMatch(/css:\s*"\.sc-[a-z0-9]+-0\{border:1px solid #ccc;\}"/) // attrs don't block precompile
    // chained: object first, fn second (application order)
    expect(out).toMatch(/attrs:\s*\[\{\s*href:\s*'#'\s*\},\s*p => \(\{\s*title:/)
  })

  it('compiles .withConfig: componentId/displayName override, shouldForwardProp stays live', () => {
    const out = run(`
      import styled from 'styled-components'
      const Named = styled.span.withConfig({ componentId: 'my-fixed-id', displayName: 'Named' })\`color: red;\`
      const Menu = styled.div.withConfig({ shouldForwardProp: prop => !['disabled'].includes(prop) })\`padding: 2px;\`
    `)
    expect(out).toMatch(/componentId:\s*"my-fixed-id"/)
    expect(out).toMatch(/displayName:\s*"Named"/)
    expect(out).toContain(".my-fixed-id{color:red;}")
    expect(out).toMatch(/shouldForwardProp:\s*prop =>/)
  })

  it('leaves unknown withConfig options untouched (real styled-components)', () => {
    const out = run(`
      import styled from 'styled-components'
      const B = styled.div.withConfig({ ssr: true })\`color: red;\`
    `)
    expect(out).not.toContain('createStyled')
    expect(out).toContain('.withConfig(')
  })

  it('leaves css / keyframes / createGlobalStyle helpers untouched', () => {
    const out = run(`
      import styled, { css, keyframes, createGlobalStyle } from 'styled-components'
      const frag = css\`color: red;\`
      const kf = keyframes\`from{opacity:0}\`
      const G = createGlobalStyle\`body{margin:0}\`
    `)
    expect(out).not.toContain('createStyled')
    expect(out).toContain('css`')
    expect(out).toContain('keyframes`')
    expect(out).toContain('createGlobalStyle`')
  })

  it('assigns a distinct componentId per component and imports createStyled once', () => {
    const out = run(`
      import styled from 'styled-components'
      const A = styled.div\`color: red;\`
      const B = styled.span\`color: blue;\`
    `)
    expect(out).toMatch(/-0"/)
    expect(out).toMatch(/-1"/)
    // single import of createStyled
    expect(out.match(/createStyled as/g) || out.match(/createStyled/g)).toBeTruthy()
    const imports = out.split('\n').filter(l => l.includes('import') && l.includes('bare-styled/runtime"'))
    expect(imports.length).toBe(1)
  })

  it('pre-compiles same-file ${Component} selectors at build time', () => {
    const out = run(`
      import styled from 'styled-components'
      const Badge = styled.span\`color: red;\`
      const Card = styled.div\`padding: 4px; \${Badge} { font-weight: 600; }\`
    `)
    // Badge's own rule + Card's rule with the nested selector resolved to
    // Badge's componentId — both fully compiled at build.
    expect(out).toMatch(/css:\s*"\.sc-[a-z0-9]+-0\{color:red;\}"/)
    expect(out).toMatch(/css:\s*"\.sc-[a-z0-9]+-1\{padding:4px;\}\.sc-[a-z0-9]+-1 \.sc-[a-z0-9]+-0\{font-weight:600;\}"/)
  })

  it('inlines same-file fully-static css`` fragments at build time', () => {
    const out = run(`
      import styled, { css } from 'styled-components'
      const pad = css\`padding: 8px 12px;\`
      const Box = styled.div\`\${pad} color: red;\`
    `)
    expect(out).toMatch(/css:\s*"\.sc-[a-z0-9]+-0\{padding:8px 12px;color:red;\}"/)
  })

  it('leaves templates live when a fragment is dynamic or unknown', () => {
    const out = run(`
      import styled, { css } from 'styled-components'
      const dyn = css\`color: \${p => p.c};\`
      const A = styled.div\`\${dyn} padding: 4px;\`
      const B = styled.div\`\${importedFragment} padding: 4px;\`
    `)
    expect(out).not.toMatch(/\bcss:/)
  })

  it('does not vendor-prefix by default; vendorPrefixes: true opts in (SC v6 parity)', () => {
    const src = `import styled from 'styled-components'\nconst A = styled.div\`display: flex; user-select: none;\``
    const plain = run(src)
    expect(plain).toMatch(/css:\s*"\.sc-[a-z0-9]+-0\{display:flex;user-select:none;\}"/)
    expect(plain).not.toContain('-webkit-')
    const prefixed = run(src, { vendorPrefixes: true })
    expect(prefixed).toContain('-webkit-')
  })

  it('bails (stays live) when a quasi has an invalid JS escape (cooked === undefined)', () => {
    // \\2022 in this source -> \2022 in the transformed code: an invalid JS
    // escape, so the quasi's cooked value is undefined. Precompiling would
    // silently drop that chunk of CSS — the template must stay live instead.
    const out = run(`
      import styled from 'styled-components'
      const A = styled.span\`content: '\\2022'; color: red;\`
    `)
    expect(out).not.toMatch(/\bcss:/)
    expect(out).toContain('createStyled') // still rewritten, just not precompiled
  })

  it('omits displayName when the option is off', () => {
    const out = run(
      `import styled from 'styled-components'\nconst A = styled.div\`color: red;\``,
      { displayName: false }
    )
    expect(out).not.toContain('displayName')
    expect(out).toMatch(/componentId:/)
  })
})
