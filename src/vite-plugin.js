// just-styled Vite plugin (`just-styled/vite`).
//
// An `enforce: 'pre'` plugin that runs the just-styled transform over source
// files BEFORE the JSX/TS compiler (designed for @vitejs/plugin-react v6+,
// whose oxc pipeline exposes no `babel` option — but it works ahead of any
// react plugin). Pair it with `react({ jsxImportSource: 'just-styled' })` so
// descriptors resolve through the wrapped automatic JSX runtime.
//
// Engines:
//   - 'oxc' (default): oxc-parser + magic-string (`../fast-transform`).
//     ~8.5x faster than Babel (≈0.7 vs ≈5.8 ms per styled file, measured on a
//     276-file corpus) with differential-tested equivalent output. Surgical
//     edits — everything but the styled templates is untouched byte-for-byte.
//   - 'babel': the reference implementation (`../js-transform`), parsing with
//     syntax-only plugins so TS + JSX survive for the downstream compiler.
//     Also used automatically, per file, when the fast engine throws.
//
// Diagnostics: JUST_STYLED_DEBUG=1 logs per transformed file the engine used,
// how many styled templates compiled to descriptors, and how many of those
// were fully precompiled at build (`css:` emitted — zero runtime style work).

const FILE_RE = /\.[jt]sx?$/
// Only files with actual styled usage (`styled.tag`, `styled(`, `styled\``, or
// a generic annotation like `styled<`) can produce work. Requiring a delimiter
// after `styled` avoids parsing files that merely mention the word (a
// `styledFoo` variable, a comment, a string). This gate is the single biggest
// lever on build cost — everything else stays at zero.
const GATE_RE = /\bstyled\s*[.(`<]/

let fastTransformFn = null
function loadFastTransform() {
  if (!fastTransformFn) {
    const mod = require('./fast-transform')
    fastTransformFn = mod.fastTransform || mod.default
  }
  return fastTransformFn
}

let babelDeps = null
function loadBabel() {
  if (!babelDeps) {
    let core
    try {
      core = require('@babel/core')
    } catch (e) {
      throw new Error(
        "just-styled/vite: the Babel engine needs @babel/core (optional peer dependency). Install it, or use engine: 'oxc'."
      )
    }
    const plugin = require('./js-transform')
    babelDeps = {
      core,
      plugin: plugin.default || plugin,
      syntaxJsx: require.resolve('@babel/plugin-syntax-jsx'),
      syntaxTs: require.resolve('@babel/plugin-syntax-typescript'),
    }
  }
  return babelDeps
}

async function babelEngine(code, filepath, transformOptions) {
  const { core, plugin, syntaxJsx, syntaxTs } = loadBabel()
  const isTs = /\.tsx?$/.test(filepath)
  const isTsx = filepath.endsWith('.tsx')
  const isJsx = filepath.endsWith('.jsx') || isTsx

  const syntaxPlugins = []
  if (isJsx) syntaxPlugins.push(syntaxJsx)
  if (isTs) syntaxPlugins.push([syntaxTs, { isTSX: isTsx }])

  const result = await core.transformAsync(code, {
    filename: filepath,
    babelrc: false,
    configFile: false,
    sourceType: 'module',
    sourceMaps: true,
    // Syntax-only parse + the styled transform. No preset-env / no typescript
    // transform, so TS + JSX survive for the downstream compiler.
    plugins: [...syntaxPlugins, [plugin, transformOptions]],
  })
  if (!result || result.code == null) return null
  return { code: result.code, map: result.map }
}

export function justStyled(options = {}) {
  const { engine = 'oxc', ...transformOptions } = options
  return {
    name: 'just-styled',
    enforce: 'pre',
    async transform(code, id) {
      const filepath = id.split('?', 1)[0]
      if (!FILE_RE.test(filepath)) return null
      if (filepath.includes('/node_modules/')) return null
      if (!GATE_RE.test(code)) return null

      let out = null
      let usedEngine = engine

      if (engine === 'oxc') {
        try {
          out = loadFastTransform()(code, { filename: filepath, ...transformOptions })
          if (out == null) return null // fast parse verified there is nothing to transform
        } catch (e) {
          // Parse error / exotic pattern: fall back to the Babel reference
          // implementation for THIS file only.
          usedEngine = 'babel(fallback)'
          out = null
        }
      } else {
        usedEngine = 'babel'
      }

      if (out == null) out = await babelEngine(code, filepath, transformOptions)
      if (out == null) return null

      if (process.env.JUST_STYLED_DEBUG) {
        const compiled = (out.code.match(/createStyled\)?\(/g) || []).length
        const precompiled = (out.code.match(/\bcss:\s*"/g) || []).length
        // eslint-disable-next-line no-console
        console.log(
          `[just-styled] [${usedEngine}] ${compiled} compiled (${precompiled} build-precompiled)  ${filepath}`
        )
      }

      return out
    },
  }
}

export default justStyled
