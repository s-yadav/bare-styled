// Builds the widget harness into a single browser bundle.
//   1. Babel-compile widget.jsx two ways (styled-components / just-styled).
//   2. esbuild-bundle harness.entry.jsx (+ React, styled-components, the
//      just-styled runtime, stylis, @emotion/is-prop-valid) into dist/harness.js.
// Run:  node profiling/widget/build.mjs   (from the repo root)
import { execSync } from 'child_process'
import { readFileSync, writeFileSync, mkdirSync } from 'fs'
import { transformSync } from '@babel/core'
import esbuild from 'esbuild'
import path from 'path'
import { fileURLToPath } from 'url'
import { createRequire } from 'module'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repo = path.resolve(__dirname, '../..')
const R = p => path.join(__dirname, p)
const runtimeSrc = path.join(repo, 'packages/runtime/src')
const require = createRequire(path.join(repo, 'package.json'))

mkdirSync(R('.build'), { recursive: true })
mkdirSync(R('dist'), { recursive: true })

// Ensure the plugin's lib/ is built (babel loads the plugin as CJS from lib).
execSync('npx babel src -d lib', { cwd: repo, stdio: 'inherit' })

const presetReact = require.resolve('@babel/preset-react')
const src = readFileSync(R('widget.jsx'), 'utf8')

const sc = transformSync(src, {
  filename: R('widget.jsx'), babelrc: false, configFile: false,
  presets: [[presetReact, { runtime: 'automatic' }]],
}).code
writeFileSync(R('.build/sc-widget.js'), sc)

const js = transformSync(src, {
  filename: R('widget.jsx'), babelrc: false, configFile: false,
  presets: [[presetReact, { runtime: 'automatic', importSource: 'just-styled' }]],
  plugins: [path.join(repo, 'lib/index.js')],
}).code
writeFileSync(R('.build/js-widget.js'), js)

await esbuild.build({
  entryPoints: [R('harness.entry.jsx')],
  bundle: true,
  format: 'iife',
  platform: 'browser',
  jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"production"' },
  outfile: R('dist/harness.js'),
  logLevel: 'info',
  alias: {
    'just-styled/runtime/patch': path.join(runtimeSrc, 'patch.js'),
    'just-styled/runtime': path.join(runtimeSrc, 'index.js'),
    'just-styled/jsx-runtime': path.join(runtimeSrc, 'jsx-runtime.js'),
    'just-styled/jsx-dev-runtime': path.join(runtimeSrc, 'jsx-dev-runtime.js'),
    'just-styled': path.join(runtimeSrc, 'index.js'),
  },
})

console.log('\nBuilt profiling/widget/dist/harness.js — open profiling/widget/harness.html')
