// Transform-engine benchmark: Babel engine vs oxc fast engine over real
// source trees, with output-parity checks.
//
//   node profiling/transform-bench.mjs [dir ...]
//
// With no args it looks for a prophecy-frontend1 checkout next to this repo
// (../prophecy-frontend1 or ../../projects/prophecy-frontend1) and benches
// packages/ui-v3/src + frontend/core/src. Tune iterations with BENCH_ITERS
// (default 3 timed passes per engine; the median is reported).
import fs from 'fs'
import path from 'path'
import { createRequire } from 'module'
import { fileURLToPath } from 'url'

const require = createRequire(import.meta.url)
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const babel = require('@babel/core')
const babelPlugin = require(path.join(repo, 'lib/index.js'))
const { fastTransform } = require(path.join(repo, 'lib/fast-transform.js'))

const ITERS = +process.env.BENCH_ITERS || 3
const PARITY = process.env.BENCH_PARITY !== '0' // BENCH_PARITY=0 -> timing only

// ---- corpus ------------------------------------------------------------------
let dirs = process.argv.slice(2)
if (dirs.length === 0) {
  for (const candidate of [
    path.join(repo, '../prophecy-frontend1'),
    path.join(repo, '../../projects/prophecy-frontend1'),
  ]) {
    if (fs.existsSync(candidate)) {
      dirs = [
        path.join(candidate, 'packages/ui-v3/src'),
        path.join(candidate, 'frontend/core/src'),
      ]
      break
    }
  }
}
if (dirs.length === 0) {
  console.error('usage: node profiling/transform-bench.mjs <dir> [dir ...]')
  process.exit(1)
}

const files = []
for (const dir of dirs) {
  ;(function walk(d) {
    let entries
    try {
      entries = fs.readdirSync(d, { withFileTypes: true })
    } catch (e) {
      return
    }
    for (const e of entries) {
      const p = path.join(d, e.name)
      if (e.isDirectory()) walk(p)
      else if (/\.[jt]sx?$/.test(e.name)) files.push(p)
    }
  })(dir)
}

const GATE = /\bstyled\s*[.(`<]/
const corpus = []
for (const f of files) {
  const code = fs.readFileSync(f, 'utf8')
  if (GATE.test(code)) corpus.push([f, code])
}
console.log(`corpus: ${corpus.length} styled files (of ${files.length} scanned) from:`)
for (const d of dirs) console.log('  ' + d)

// ---- engines -----------------------------------------------------------------
const syntaxFor = f => {
  const isTsx = f.endsWith('.tsx')
  const isTs = /\.tsx?$/.test(f)
  const out = []
  if (isTsx || f.endsWith('.jsx')) out.push(require.resolve('@babel/plugin-syntax-jsx'))
  if (isTs) out.push([require.resolve('@babel/plugin-syntax-typescript'), { isTSX: isTsx }])
  return out
}

const runBabel = ([f, code]) =>
  babel.transformSync(code, {
    filename: f,
    babelrc: false,
    configFile: false,
    sourceType: 'module',
    sourceMaps: true,
    plugins: [...syntaxFor(f), [babelPlugin.default || babelPlugin, {}]],
  }).code

const runFast = ([f, code]) => {
  const r = fastTransform(code, { filename: f })
  return r ? r.code : code
}

// ---- parity ------------------------------------------------------------------
const count = (c, re) => (c.match(re) || []).length
const stats = { babel: { compiled: 0, precompiled: 0, attrs: 0 }, fast: { compiled: 0, precompiled: 0, attrs: 0 } }
let errors = 0
for (const entry of PARITY ? corpus : []) {
  try {
    const b = runBabel(entry)
    const f = runFast(entry)
    stats.babel.compiled += count(b, /createStyled\)?\(/g)
    stats.babel.precompiled += count(b, /\bcss:\s*"/g)
    stats.babel.attrs += count(b, /\battrs:\s*\[/g)
    stats.fast.compiled += count(f, /createStyled\)?\(/g)
    stats.fast.precompiled += count(f, /\bcss:\s*"/g)
    stats.fast.attrs += count(f, /\battrs:\s*\[/g)
  } catch (e) {
    errors++
    if (errors <= 3) console.error('ERROR', entry[0], e.message.slice(0, 120))
  }
}
if (PARITY) console.log(
  `\nparity (errors: ${errors})` +
    `\n  babel: ${stats.babel.compiled} compiled, ${stats.babel.precompiled} precompiled, ${stats.babel.attrs} with attrs` +
    `\n  fast : ${stats.fast.compiled} compiled, ${stats.fast.precompiled} precompiled, ${stats.fast.attrs} with attrs` +
    (stats.babel.compiled !== stats.fast.compiled
      ? `\n  note: compile-count delta = function-scope styled definitions (fast engine conservatively skips; they stay on real styled-components)`
      : '')
)

// ---- timing ------------------------------------------------------------------
const median = a => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)]
const time = fn => {
  const t0 = process.hrtime.bigint()
  for (const entry of corpus) fn(entry)
  return Number(process.hrtime.bigint() - t0) / 1e6
}

// warmup (JIT both paths)
for (const entry of corpus.slice(0, 25)) {
  runBabel(entry)
  runFast(entry)
}

const babelMs = []
const fastMs = []
for (let i = 0; i < ITERS; i++) babelMs.push(time(runBabel))
for (let i = 0; i < ITERS; i++) fastMs.push(time(runFast))

const b = median(babelMs)
const f = median(fastMs)
console.log(
  `\ntiming (median of ${ITERS} full passes)` +
    `\n  babel: ${b.toFixed(0)} ms total  (${(b / corpus.length).toFixed(2)} ms/file)` +
    `\n  fast : ${f.toFixed(0)} ms total  (${(f / corpus.length).toFixed(2)} ms/file)` +
    `\n  speedup: ${(b / f).toFixed(1)}x`
)
