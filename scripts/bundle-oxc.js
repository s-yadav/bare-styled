// Regenerates vendor/oxc-parser.cjs — a CJS bundle of oxc-parser's ESM
// wrapper, used by src/fast-transform.js as a fallback in CJS-only module
// systems (jest). The native napi binding stays EXTERNAL and resolves from
// node_modules at runtime, so the bundle is platform-independent.
//
// Run after bumping the oxc-parser dependency:  node scripts/bundle-oxc.js
'use strict'

const path = require('path')
const esbuild = require('esbuild')

const entry = require.resolve('oxc-parser/package.json')
const entryDir = path.dirname(entry)
const main = path.join(entryDir, require(entry).main || 'src-js/index.js')

esbuild.buildSync({
  entryPoints: [main],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node18',
  outfile: path.join(__dirname, '../vendor/oxc-parser.cjs'),
  external: ['@oxc-parser/*', '*.node'],
  define: { 'import.meta.url': '__importMetaUrl' },
  banner: { js: 'const __importMetaUrl = require("url").pathToFileURL(__filename).href;' },
  logLevel: 'info',
})

console.log('vendor/oxc-parser.cjs regenerated')
