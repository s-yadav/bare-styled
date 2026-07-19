// The oxc fast transform must be functionally equivalent to the Babel plugin:
// same componentId scheme (identical file hash), same precompile policy, same
// emitted css strings. Differential-tested against the Babel plugin on shared
// sources, plus an e2e render of fast-transformed code.
import { transformSync } from '@babel/core'
import path from 'path'
import babelPlugin from '../src/js-transform'
import { fastTransform } from '../src/fast-transform'

const FILENAME = path.join(__dirname, 'Sample.jsx')

const babelRun = (code, opts = {}) =>
  transformSync(code, {
    filename: FILENAME,
    babelrc: false,
    configFile: false,
    plugins: [[babelPlugin, opts]],
  }).code

const fastRun = (code, opts = {}) => {
  const r = fastTransform(code, { filename: FILENAME, ...opts })
  return r && r.code
}

// Extract { componentId -> {displayName, css} } from transformed output.
const extractConfigs = code => {
  const out = {}
  const re = /componentId:\s*"([^"]+)"(?:,\s*displayName:\s*"([^"]+)")?(?:,\s*css:\s*"((?:[^"\\]|\\.)*)")?/g
  let m
  while ((m = re.exec(code))) out[m[1]] = { displayName: m[2], css: m[3] && JSON.parse('"' + m[3] + '"') }
  return out
}

const SHARED = `
import styled, { css } from 'styled-components'
const theme = { border: '#e5e7eb', space: { sm: 8 } }
const RADIUS = '8px'
const pad = css\`padding: 8px 12px;\`
const Badge = styled.span\`color: red;\`
const Card = styled.div\`
  padding: 4px; border: 1px solid \${theme.border}; border-radius: \${RADIUS};
  \${Badge} { font-weight: 600; }
  \${pad}
\`
const Cell = styled.td\`margin: \${theme.space.sm}px;\`
const Dyn = styled.a\`color: \${p => p.c};\`
const Ext = styled(Badge)\`font-size: 12px;\`
const Chain = styled.input.attrs({})\`x: 1;\`
const frag = css\`color: \${p => p.c};\`
const DynFrag = styled.b\`\${frag} padding: 2px;\`
`

describe('fast transform vs babel plugin (differential)', () => {
  it('emits identical componentIds, displayNames and precompiled css', () => {
    const b = extractConfigs(babelRun(SHARED))
    const f = extractConfigs(fastRun(SHARED))
    expect(Object.keys(f)).toEqual(Object.keys(b)) // same ids, same order/scheme
    for (const id of Object.keys(b)) {
      expect(f[id].displayName).toBe(b[id].displayName)
      expect(f[id].css).toBe(b[id].css) // same precompile decision AND bytes
    }
    // sanity on the shared expectations themselves
    const ids = Object.keys(b)
    expect(b[ids[1]].css).toContain('border:1px solid #e5e7eb') // Card resolved
    expect(b[ids[1]].css).toContain('font-weight:600') // ${Badge} selector
    expect(b[ids[3]].css).toBeUndefined() // Dyn stays live
  })

  it('leaves .attrs chains and dynamic fragments untouched/live like babel', () => {
    const f = fastRun(SHARED)
    expect(f).toContain('styled.input.attrs({})`x: 1;`') // untouched, byte-for-byte
    expect(f).toMatch(/DynFrag = _createStyled\("b", \{ [^}]*\}\)`\$\{frag\} padding: 2px;`/) // live
  })

  it('bails to live on invalid escapes (cooked null), like babel', () => {
    const src = `import styled from 'styled-components'\nconst A = styled.span\`content: '\\2022'; color: red;\``
    expect(fastRun(src)).not.toMatch(/css:/)
    expect(babelRun(src)).not.toMatch(/css:/)
  })

  it('returns null when there is nothing to do', () => {
    expect(fastRun(`export const x = 1`)).toBe(null)
    expect(fastRun(`import styled from 'other-lib'\nconst A = styled.div\`c: red;\``)).toBe(null)
  })

  it('respects namespace, runtimeImportPath and displayName:false', () => {
    const src = `import styled from 'styled-components'\nconst A = styled.div\`color: red;\``
    const out = fastRun(src, { namespace: 'app', runtimeImportPath: 'my-runtime', displayName: false })
    expect(out).toMatch(/componentId:\s*"app__sc-[a-z0-9]+-0"/)
    expect(out).not.toContain('displayName')
    expect(out).toContain('from "my-runtime"')
    expect(out).toContain('import "my-runtime/patch"')
  })

  it('skips function-scope styled templates (conservative; babel engine covers them)', () => {
    const src = `
      import styled from 'styled-components'
      function make() { return styled.div\`color: red;\` }
      const Top = styled.span\`color: blue;\`
    `
    const out = fastRun(src)
    expect(out).toContain('function make() { return styled.div`color: red;` }') // untouched
    expect(out).toMatch(/Top = _createStyled\("span"/)
  })

  it('avoids identifier collisions with existing _createStyled', () => {
    const src = `import styled from 'styled-components'\nconst _createStyled = 1\nconst A = styled.div\`color: red;\``
    const out = fastRun(src)
    expect(out).toMatch(/createStyled as _createStyled\$/)
  })
})

describe('fast transform e2e (render through the runtime)', () => {
  it('fast-transformed code renders identically', () => {
    /** environment: this test file runs in node; use jsdom manually */
    const { JSDOM } = require('jsdom')
    const dom = new JSDOM('<div id="r"></div>')
    global.window = dom.window
    global.document = dom.window.document
    const runtime = require('just-styled/runtime')

    const src = `
      import React from 'react'
      import styled from 'styled-components'
      const theme = { fg: '#111' }
      const Box = styled.div\`color: \${theme.fg}; padding: 4px;\`
      const Tint = styled.span\`background: \${p => p.bg};\`
      export function App() { return <Box><Tint bg="red">x</Tint></Box> }
    `
    const fast = fastTransform(src, { filename: FILENAME }).code
    const { code } = transformSync(fast, {
      filename: FILENAME,
      babelrc: false,
      configFile: false,
      presets: [[require.resolve('@babel/preset-react'), { runtime: 'classic' }]],
      plugins: [require.resolve('@babel/plugin-transform-modules-commonjs')],
    })
    const requireShim = r => {
      if (r === 'just-styled/runtime') return runtime
      if (r === 'just-styled/runtime/patch') {
        runtime.installCreateElementPatch()
        return {}
      }
      return require(r)
    }
    const mod = { exports: {} }
    new Function('exports', 'require', 'module', code)(mod.exports, requireShim, mod)

    const React = require('react')
    const { renderToStaticMarkup } = require('react-dom/server')
    const html = renderToStaticMarkup(React.createElement(mod.exports.App))
    expect(html).toMatch(/class="sc-[a-z0-9]+-0"/) // static box: componentId only
    expect(html).toMatch(/class="sc-[a-z0-9]+-1 js-[a-z0-9]+"/) // dynamic tint: + hash class
    expect(runtime.getCss()).toContain('color:#111')
    expect(runtime.getCss()).toMatch(/background:\s*red/)
    runtime.uninstallCreateElementPatch()
    runtime.__resetSheet()
    delete global.window
    delete global.document
  })
})
