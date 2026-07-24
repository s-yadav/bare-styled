// just-styled Vite plugin (`just-styled/vite`). enforce: 'pre' — runs the
// transform BEFORE the JSX/TS compiler; pair with
// react({ jsxImportSource: 'just-styled' }). Engines: 'oxc' (default, fast)
// or 'babel' (reference; also the automatic per-file fallback when the fast
// engine throws). JUST_STYLED_DEBUG=1 logs per-file stats.

const FILE_RE = /\.[jt]sx?$/
// Requiring a delimiter after `styled` avoids parsing files that merely
// mention the word. This gate is the biggest lever on build cost.
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
    // Syntax-only parse: TS + JSX survive for the downstream compiler.
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
          if (out == null) return null // fast parse verified nothing to transform
        } catch (e) {
          // Parse error / exotic pattern: Babel fallback for THIS file only.
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
        const bailed = (out.stats && out.stats.bailed) || []
        const fnScoped = (out.stats && out.stats.fnScoped) || []
        // eslint-disable-next-line no-console
        console.log(
          `[just-styled] [${usedEngine}] ${compiled} compiled (${precompiled} build-precompiled)` +
            (bailed.length ? `  BAILED->styled-components: ${bailed.join(', ')}` : '') +
            (fnScoped.length ? `  fn-scoped(skipped): ${fnScoped.join(', ')}` : '') +
            `  ${filepath}`
        )
      }
      // Mixed rendering in one file (some templates on just-styled, some on
      // styled-components) breaks cascade-tie ordering between the two sheets —
      // always warn, this is how silent layout breakage starts.
      if (out.stats && out.stats.bailed && out.stats.bailed.length) {
        // eslint-disable-next-line no-console
        console.warn(
          `[just-styled] ${filepath}: ${out.stats.bailed.length} styled template(s) left on real ` +
            `styled-components (${out.stats.bailed.join(', ')}) — unknown withConfig option or exotic ` +
            `chain shape. Overrides between these and just-styled components are not order-guaranteed.`
        )
      }

      return out
    },
  }
}

export default justStyled
