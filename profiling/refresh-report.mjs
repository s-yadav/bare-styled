// Re-run the full runtime perf matrix and rebuild docs/perf-report.html from
// median-of-runs numbers — one command, no hand-editing:
//
//   node profiling/refresh-report.mjs
//
// Env knobs:
//   REPORT_REPS=3          benchmark runs per profile (median taken across runs;
//                          each run is itself a median of 12–25 iterations)
//   REPORT_PROFILES=a,b    collect only these profile ids (see PROFILES below).
//                          Prints a summary but does NOT patch the report unless
//                          all nine profiles were collected.
//   REPORT_FROM_CSV=path   skip collection; aggregate an existing samples CSV
//                          (lines: profileId,scMount,scUpdate,jsMount,jsUpdate)
//
// Samples are appended to profiling/.last-perf-samples.csv so a run can be
// inspected or re-aggregated later.
import { execSync } from 'child_process'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const REPORT = path.join(repo, 'docs/perf-report.html')
const SAMPLES = path.join(repo, 'profiling/.last-perf-samples.csv')
const REPS = +process.env.REPORT_REPS || 3

const PROFILES = [
  { id: 'w60-few',      label: '60×5, few tints',                    nodes: '508',   test: 'widget',    env: { WIDGET_TINT: 'few' } },
  { id: 'w60-static',   label: '60×5, all static',                   nodes: '508',   test: 'widget',    env: { WIDGET_TINT: 'static' } },
  { id: 'w60-unique',   label: '60×5, unique tint per cell',         nodes: '508',   test: 'widget',    env: { WIDGET_TINT: 'unique' } },
  { id: 'wXL-few',      label: '200×8, few tints',                   nodes: '2,228', test: 'widget',    env: { WIDGET_TINT: 'few', WIDGET_ROWS: '200', WIDGET_COLS: '8', WIDGET_ITERS: '12' } },
  { id: 'wXL-static',   label: '200×8, all static',                  nodes: '2,228', test: 'widget',    env: { WIDGET_TINT: 'static', WIDGET_ROWS: '200', WIDGET_COLS: '8', WIDGET_ITERS: '12' } },
  { id: 'wXL-unique',   label: '200×8, unique tint per cell',        nodes: '2,228', test: 'widget',    env: { WIDGET_TINT: 'unique', WIDGET_ROWS: '200', WIDGET_COLS: '8', WIDGET_ITERS: '12' } },
  { id: 'dash-mixed',   label: '150 rows, mixed cells (real-world)', nodes: '1,242', test: 'dashboard', env: { DASH_MODE: 'mixed' } },
  { id: 'dash-static',  label: '150 rows, all-static cells',         nodes: '1,242', test: 'dashboard', env: { DASH_MODE: 'static' } },
  { id: 'dash-dynamic', label: '150 rows, all-dynamic cells',        nodes: '1,242', test: 'dashboard', env: { DASH_MODE: 'dynamic' } },
]

// ---- collect ------------------------------------------------------------------
function runOnce(profile) {
  const out = execSync(`npx jest test/perf/${profile.test}.perf.test.js 2>&1`, {
    cwd: repo,
    env: { ...process.env, ...profile.env },
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const sc = out.match(/^\s+styled-comp\s+([\d.]+)\s+([\d.]+)/m)
  const js = out.match(/^\s+bare-styled\s+([\d.]+)\s+([\d.]+)/m)
  if (!sc || !js) throw new Error(`could not parse benchmark output for ${profile.id}`)
  return [+sc[1], +sc[2], +js[1], +js[2]] // scMount, scUpdate, jsMount, jsUpdate
}

let samples = [] // [id, sm, su, jm, ju]
if (process.env.REPORT_FROM_CSV) {
  for (const line of fs.readFileSync(process.env.REPORT_FROM_CSV, 'utf8').trim().split('\n')) {
    const [id, sm, su, jm, ju] = line.split(',')
    samples.push([id, +sm, +su, +jm, +ju])
  }
  console.log(`aggregating ${samples.length} samples from ${process.env.REPORT_FROM_CSV}`)
} else {
  const only = process.env.REPORT_PROFILES ? process.env.REPORT_PROFILES.split(',') : null
  const todo = PROFILES.filter(p => !only || only.includes(p.id))
  console.log(`collecting: ${todo.length} profiles x ${REPS} runs (each run = median of its own iterations)`)
  for (let rep = 1; rep <= REPS; rep++) {
    for (const p of todo) {
      const [sm, su, jm, ju] = runOnce(p)
      samples.push([p.id, sm, su, jm, ju])
      console.log(`  [${rep}/${REPS}] ${p.id.padEnd(13)} SC ${sm.toFixed(2)}/${su.toFixed(2)}  JS ${jm.toFixed(2)}/${ju.toFixed(2)}`)
    }
  }
  fs.writeFileSync(SAMPLES, samples.map(s => s.join(',')).join('\n') + '\n')
  console.log(`samples written to ${path.relative(repo, SAMPLES)}`)
}

// ---- aggregate ------------------------------------------------------------------
const median = a => {
  const s = [...a].sort((x, y) => x - y)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}
const byId = {}
for (const [id, ...vals] of samples) (byId[id] = byId[id] || []).push(vals)

const rows = []
for (const p of PROFILES) {
  const runs = byId[p.id]
  if (!runs) continue
  const [sm, su, jm, ju] = [0, 1, 2, 3].map(i => median(runs.map(r => r[i])))
  rows.push({
    ...p, n: runs.length, sm, su, jm, ju,
    dm: Math.round((sm - jm) / sm * 100),
    du: Math.round((su - ju) / su * 100),
  })
}

console.log('\nmedians:')
for (const r of rows) {
  console.log(`  ${r.id.padEnd(13)} n=${r.n}  SC ${r.sm.toFixed(2)}/${r.su.toFixed(2)}  JS ${r.jm.toFixed(2)}/${r.ju.toFixed(2)}  Δ +${r.dm}%/+${r.du}%`)
}
const avg = k => Math.round(rows.reduce((s, r) => s + r[k], 0) / rows.length)
const best = Math.max(...rows.map(r => r.du))
console.log(`  AVG mount +${avg('dm')}%  re-render +${avg('du')}%  best re-render +${best}%`)

// ---- patch the report -----------------------------------------------------------
if (rows.length !== PROFILES.length) {
  console.log('\npartial profile set — report NOT patched (need all nine).')
  process.exit(0)
}

let html = fs.readFileSync(REPORT, 'utf8')
const f2 = n => n.toFixed(2)
const arr = k => rows.map(r => f2(r[k])).join(', ')

html = html.replace(/const JS = \{ mount: \[[^\]]*\],\s*\n\s*update: \[[^\]]*\] \};/,
  `const JS = { mount: [${arr('jm')}],\n             update: [${arr('ju')}] };`)
html = html.replace(/const SC = \{ mount: \[[^\]]*\],\s*\n\s*update: \[[^\]]*\] \};/,
  `const SC = { mount: [${arr('sm')}],\n             update: [${arr('su')}] };`)

for (const r of rows) {
  const row =
    `<tr><td>${r.label}</td><td class="num">${r.nodes}</td>` +
    `<td class="num">${f2(r.sm)}</td><td class="num">${f2(r.jm)}</td>` +
    `<td class="num"><span class="delta">+${r.dm}%</span></td>` +
    `<td class="num">${f2(r.su)}</td><td class="num">${f2(r.ju)}</td>` +
    `<td class="num"><span class="delta">+${r.du}%</span></td></tr>`
  const re = new RegExp('<tr><td>' + r.label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '</td>.*?</tr>')
  if (!re.test(html)) throw new Error(`report row not found for "${r.label}" — table layout changed?`)
  html = html.replace(re, row)
}

html = html.replace(/<div class="v">\d+%<\/div><div class="l">avg\. faster mount<\/div>/,
  `<div class="v">${avg('dm')}%</div><div class="l">avg. faster mount</div>`)
html = html.replace(/<div class="v">\d+%<\/div><div class="l">avg\. faster re-render<\/div>/,
  `<div class="v">${avg('du')}%</div><div class="l">avg. faster re-render</div>`)
html = html.replace(/<div class="v">\d+%<\/div><div class="l">best re-render/,
  `<div class="v">${best}%</div><div class="l">best re-render`)

fs.writeFileSync(REPORT, html)
console.log(`\nreport rebuilt: ${path.relative(repo, REPORT)} (avg +${avg('dm')}%/+${avg('du')}%, best +${best}%)`)
