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
  it('rewrites styled.tag, keeping interpolations live', () => {
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
    // interpolations are STILL LIVE in the template (not resolved at compile)
    expect(out).toMatch(/background:\s*\$\{theme\.bg\}|\$\{theme\.bg\}/)
    expect(out).toContain('props => props.color')
    // runtime imports injected
    expect(out).toMatch(/from ['"]just-styled\/runtime['"]/)
    expect(out).toMatch(/just-styled\/runtime\/patch/)
  })

  it('pre-compiles a zero-interpolation template at build time (Opt 2)', () => {
    const out = run(`
      import styled from 'styled-components'
      const A = styled.div\`color: red; padding: 8px;\`
    `)
    // finished stylis output emitted as css, keyed to the componentId; the
    // template body is dropped (no runtime stylis for pure-static rules).
    expect(out).toMatch(/css:\s*"\.sc-[a-z0-9]+-0\{color:red;padding:8px;\}"/)
    expect(out).not.toMatch(/color: red; padding: 8px;/) // raw template gone
  })

  it('does NOT pre-compile when the template has interpolations', () => {
    const out = run(`
      import styled from 'styled-components'
      const t = { c: 'red' }
      const A = styled.div\`color: \${t.c};\`
    `)
    expect(out).not.toMatch(/\bcss:/) // left to runtime resolution
    expect(out).toContain('t.c')
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

  it('leaves .attrs / .withConfig chains untouched (real styled-components)', () => {
    const out = run(`
      import styled from 'styled-components'
      const A = styled.div.attrs(() => ({}))\`color: red;\`
      const B = styled.div.withConfig({ componentId: 'x' })\`color: red;\`
    `)
    expect(out).not.toContain('createStyled')
    expect(out).toContain('.attrs(')
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
    const imports = out.split('\n').filter(l => l.includes('import') && l.includes('just-styled/runtime"'))
    expect(imports.length).toBe(1)
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
