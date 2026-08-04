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

  it('compiles .attrs chains and keeps dynamic fragments live, like babel', () => {
    const f = fastRun(SHARED)
    expect(f).toMatch(/Chain = _createStyled\("input", \{ [^)]*attrs: \[\{\}\]/) // attrs compiled
    expect(f).toMatch(/DynFrag = _createStyled\("b", \{ [^}]*\}\)`\$\{frag\} padding: 2px;`/) // live
  })

  it('withConfig forwardProps compiles in both engines (expression stays live)', () => {
    const src = `
      import styled from 'styled-components'
      const Stack = styled.div.withConfig({ forwardProps: ({ gap, ...rest }) => rest })\`gap: \${p => p.gap}px;\`
    `
    for (const out of [babelRun(src), fastRun(src)]) {
      expect(out).toMatch(/forwardProps:\s*\(\{\s*gap,\s*\.\.\.rest\s*\}\) => rest/)
      expect(out).toMatch(/skeleton:|gap: \$\{p => p\.gap\}px/) // template compiled independently
    }
  })

  it('compiles styled(Compound.Member) and styled(Comp<T>) in both engines', () => {
    const tsxFile = path.join(__dirname, 'Sample.tsx')
    const src = `
      import styled from 'styled-components'
      import { Dropdown, Tree } from 'ui'
      const Item = styled(Dropdown.Item)\`gap: 8px;\`
      const FileTree = styled(Tree<FileNode>)\`width: 100%;\`
      const Deep = styled(A.B.C)\`color: red;\`
      const Computed = styled(Dropdown[key])\`color: blue;\`
    `
    const b = transformSync(src, {
      filename: tsxFile,
      babelrc: false,
      configFile: false,
      plugins: [
        [require.resolve('@babel/plugin-syntax-typescript'), { isTSX: true }],
        [babelPlugin, {}],
      ],
    }).code
    const f = fastTransform(src, { filename: tsxFile }).code
    for (const out of [b, f]) {
      expect(out).toMatch(/_createStyled\$*\(Dropdown\.Item, \{/)
      expect(out).toMatch(/_createStyled\$*\(Tree, \{/) // TS instantiation unwrapped
      expect(out).toMatch(/_createStyled\$*\(A\.B\.C, \{/)
      expect(out).toMatch(/styled\(Dropdown\[key\]\)`color: blue;`/) // computed member bails
    }
  })

  it('withConfig parity: fixed componentId + shouldForwardProp compile, unknown keys bail (both engines)', () => {
    const src = `
      import styled from 'styled-components'
      const Named = styled.span.withConfig({ componentId: 'my-id' })\`color: red;\`
      const Menu = styled.div.withConfig({ shouldForwardProp: p => p !== 'x' })\`padding: 2px;\`
      const Weird = styled.b.withConfig({ ssr: true })\`x: 1;\`
    `
    const b = babelRun(src)
    const f = fastRun(src)
    for (const out of [b, f]) {
      expect(out).toMatch(/componentId:\s*"my-id"/)
      expect(out).toContain('.my-id{color:red;}')
      expect(out).toMatch(/shouldForwardProp:\s*p => p !== 'x'/)
      expect(out).toMatch(/\.withConfig\(\{\s*ssr: true\s*\}\)`x: 1;`/) // bailed identically
    }
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

describe('skeleton emit parity (value-position residuals)', () => {
  const SRC = `
    import styled, { css } from 'styled-components'
    const theme = { border: '#eee' }
    const A = styled.div\`color: \${p => p.c}; border: 1px solid \${theme.border};\`
    const Hover = styled.a\`color: \${p => p.c}; &:hover { background: \${p => p.bg}; }\`
    const Multi = styled.i\`margin: \${p => p.t}px \${p => p.r}px;\`
    const Media = styled.b\`@media (max-width: \${p => p.bp}px) { padding: 2px; }\`
    const SelectorPos = styled.u\`\${p => p.sel} { color: red; }\`
    const BlockPos = styled.s\`\${p => p.on && 'color: red;'} padding: 1px;\`
  `
  it('both engines agree: skeletons for value slots, live for block/selector slots', () => {
    const b = babelRun(SRC)
    const f = fastRun(SRC)
    for (const out of [b, f]) {
      expect(out).toMatch(/skeleton:\s*"\.__bsc__\{color:var\(--bs-0\);border:1px solid #eee;\}"/) // A
      expect(out).toMatch(/skeleton:\s*"\.__bsc__\{color:var\(--bs-0\);\}\.__bsc__:hover\{background:var\(--bs-1\);\}"/) // Hover: stylis ran at BUILD
      expect(out).toMatch(/skeleton:\s*"\.__bsc__\{margin:var\(--bs-0\)px var\(--bs-1\)px;\}"/) // Multi: both value slots
      expect(out).toMatch(/@media \(max-width: ?var\(--bs-0\)px\)/) // Media: breakpoint slot
      // selector/block-position residuals stay LIVE (structure can change)
      expect(out).toMatch(/SelectorPos = _?createStyled\)?\("u"[^`]*`\$\{p => p\.sel\}/)
      expect(out).toMatch(/BlockPos = _?createStyled\)?\("s"[^`]*`\$\{p => p\.on && 'color: red;'\}/)
    }
  })
})

describe('fast transform e2e (render through the runtime)', () => {
  it('callback .attrs survives the pipeline: transform -> eval -> render', () => {
    const { JSDOM } = require('jsdom')
    const dom = new JSDOM('<div id="r"></div>')
    global.window = dom.window
    global.document = dom.window.document
    const runtime = require('bare-styled/runtime')

    const src = `
      import React from 'react'
      import styled from 'styled-components'
      const Input = styled.input.attrs((props) => ({
        type: props.$secret ? 'password' : 'text',
        'data-kind': 'field',
      }))\`border: 1px solid #ccc; width: \${p => p.$w}px;\`
      export function App() { return <Input $secret $w={120} /> }
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
      if (r === 'bare-styled/runtime') return runtime
      if (r === 'bare-styled/runtime/patch') {
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
    expect(html).toContain('type="password"') // callback saw $secret
    expect(html).toContain('data-kind="field"')
    expect(html).not.toContain('$secret') // transient props filtered from the DOM
    expect(runtime.getCss()).toMatch(/width:\s*120px/) // interpolation resolved
    runtime.uninstallCreateElementPatch()
    runtime.__resetSheet()
    delete global.window
    delete global.document
  })

  it('fast-transformed code renders identically', () => {
    /** environment: this test file runs in node; use jsdom manually */
    const { JSDOM } = require('jsdom')
    const dom = new JSDOM('<div id="r"></div>')
    global.window = dom.window
    global.document = dom.window.document
    const runtime = require('bare-styled/runtime')

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
      if (r === 'bare-styled/runtime') return runtime
      if (r === 'bare-styled/runtime/patch') {
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
    expect(html).toMatch(/class="sc-[a-z0-9]+-1 bs-[a-z0-9]+"/) // dynamic tint: + hash class
    expect(runtime.getCss()).toContain('color:#111')
    expect(runtime.getCss()).toMatch(/background:\s*red/)
    runtime.uninstallCreateElementPatch()
    runtime.__resetSheet()
    delete global.window
    delete global.document
  })
})
