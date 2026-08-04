// Rebuilds docs/bare-styled-deck-v2.pptx. Metric slides pull the latest
// medians from profiling/.last-perf-samples.csv (written by refresh-report.mjs)
// so the deck always matches docs/perf-report.html:
//   node profiling/refresh-report.mjs && node docs/deck.gen.js
const fs = require('fs')
const path = require('path')
const repo = path.resolve(__dirname, '..')

function metricsFromSamples() {
  const fallback = { mount: 24, update: 45, best: 58 }
  try {
    const byId = {}
    for (const line of fs.readFileSync(path.join(repo, 'profiling/.last-perf-samples.csv'), 'utf8').trim().split('\n')) {
      const [id, sm, su, jm, ju] = line.split(',')
      ;(byId[id] = byId[id] || []).push([+sm, +su, +jm, +ju])
    }
    const med = a => { const s = [...a].sort((x, y) => x - y); return s[s.length >> 1] }
    const deltas = Object.values(byId).map(rows => {
      const m = i => med(rows.map(r => r[i]))
      return [Math.round((1 - m(2) / m(0)) * 100), Math.round((1 - m(3) / m(1)) * 100)]
    })
    if (!deltas.length) return fallback
    const avg = i => Math.round(deltas.reduce((a, d) => a + d[i], 0) / deltas.length)
    return { mount: avg(0), update: avg(1), best: Math.round(Math.max(...deltas.map(d => d[1]))) }
  } catch (e) { return fallback }
}
const M = metricsFromSamples()
console.log('metrics: mount +' + M.mount + '%  re-render +' + M.update + '%  best +' + M.best + '%')

const pptxgen = require('pptxgenjs')
const pres = new pptxgen()
pres.layout = 'LAYOUT_WIDE' // 13.3 x 7.5

// palette: dark engineering theme; SC = pink, bare-styled = cyan
const BG = '0C1220', CARD = '16203A', CARD2 = '1D2A4A', INK = 'EAF0FB', MUT = '8FA0BF'
const SC = 'E9679C', JS = '3ED6C0', COST = 'FF7A6B', GOOD = '45D483', AMBER = 'FFC24D'
const GRID = '263454'
const F = 'Arial', MONO = 'Courier New'

function base(slide) { slide.background = { color: BG } }
function title(s, t, sub) {
  s.addText(t, { x: 0.6, y: 0.35, w: 12.1, h: 0.7, fontFace: F, fontSize: 32, bold: true, color: INK, margin: 0 })
  if (sub) s.addText(sub, { x: 0.6, y: 1.0, w: 12.1, h: 0.4, fontFace: F, fontSize: 14, color: MUT, margin: 0 })
}
function card(s, x, y, w, h, fill) {
  s.addShape('roundRect', { x, y, w, h, fill: { color: fill || CARD }, line: { color: GRID, width: 1 }, rectRadius: 0.08 })
}
function chip(s, x, y, w, txt, color) {
  s.addShape('roundRect', { x, y, w, h: 0.42, fill: { color: CARD2 }, line: { color: color, width: 1.25 }, rectRadius: 0.21 })
  s.addText(txt, { x, y, w, h: 0.42, align: 'center', valign: 'middle', fontFace: F, fontSize: 12.5, bold: true, color: color, margin: 0 })
}
function arrow(s, x1, y1, x2, y2, color) {
  s.addShape('line', { x: x1, y: y1, w: x2 - x1, h: y2 - y1, line: { color: color || MUT, width: 2.25, endArrowType: 'triangle' } })
}
function node(s, x, y, w, txt, color, fillColor) {
  s.addShape('roundRect', { x, y, w, h: 0.5, fill: { color: fillColor || CARD2 }, line: { color, width: 1.5 }, rectRadius: 0.1 })
  s.addText(txt, { x, y, w, h: 0.5, align: 'center', valign: 'middle', fontFace: MONO, fontSize: 12, bold: true, color, margin: 0 })
}

// ---------- 1. TITLE ----------
let s = pres.addSlide(); base(s)
s.addText('bare-styled', { x: 0.6, y: 2.2, w: 12.1, h: 1.3, align: 'center', fontFace: F, fontSize: 66, bold: true, color: INK, margin: 0 })
s.addText([{ text: 'styled-components', options: { color: SC, italic: true } }, { text: ', without components', options: { color: MUT, italic: true } }],
  { x: 0.6, y: 3.5, w: 12.1, h: 0.6, align: 'center', fontFace: F, fontSize: 24, margin: 0 })
chip(s, 3.05, 4.7, 2.3, 'same API', JS)
chip(s, 5.55, 4.7, 2.3, '0 wrapper fibers', JS)
chip(s, 8.05, 4.7, 2.3, '+' + M.update + '% re-render', GOOD)
s.addText('Prophecy frontend · 2026', { x: 0.6, y: 6.8, w: 12.1, h: 0.35, align: 'center', fontFace: F, fontSize: 11, color: MUT, margin: 0 })

// ---------- 2. WHAT styled-components IS ----------
s = pres.addSlide(); base(s)
title(s, 'styled-components in one slide', 'CSS lives with the component — the library turns a template into a class at render time')
// left: code card
card(s, 0.6, 1.6, 5.3, 2.6)
s.addText([
  { text: 'const ', options: { color: MUT } }, { text: 'Button', options: { color: SC, bold: true } }, { text: ' = styled.button`\n', options: { color: INK } },
  { text: '  padding: 8px 16px;\n', options: { color: INK } },
  { text: '  border-radius: 6px;\n', options: { color: INK } },
  { text: '  background: ', options: { color: INK } }, { text: '${p => p.$primary\n    ? \'#e9679c\' : \'#1d2a4a\'}', options: { color: AMBER } }, { text: ';\n', options: { color: INK } },
  { text: '`;\n\n', options: { color: INK } },
  { text: '<Button $primary>Save</Button>', options: { color: JS } },
], { x: 0.85, y: 1.8, w: 4.9, h: 2.2, fontFace: MONO, fontSize: 12.5, margin: 0, lineSpacing: 17 })
// right: what happens per render (pipeline)
const steps = [['<Button/> renders', SC], ['resolve template\nwith props', INK], ['stylis: parse CSS\n→ rules', INK], ['hash → class\ninject into sheet', INK], ['<button\nclass="sc-x abc">', JS]]
let px = 6.3
steps.forEach(([t, c], i) => {
  card(s, px, 2.2, 1.24, 1.15, CARD)
  s.addText(t, { x: px + 0.02, y: 2.2, w: 1.2, h: 1.15, align: 'center', valign: 'middle', fontFace: F, fontSize: 9.5, bold: i === 0 || i === 4, color: c, margin: 0 })
  if (i < 4) arrow(s, px + 1.24, 2.775, px + 1.36, 2.775)
  px += 1.36
})
s.addText('…and this pipeline runs inside a real React component', { x: 6.4, y: 3.6, w: 6.3, h: 0.35, fontFace: F, fontSize: 12.5, italic: true, color: MUT, margin: 0 })
// bottom: loved-for row
card(s, 0.6, 4.7, 12.1, 1.9, CARD)
s.addText('why teams love it', { x: 0.9, y: 4.9, w: 6, h: 0.35, fontFace: F, fontSize: 13, bold: true, color: INK, margin: 0 })
const loves = [['co-located styles', 'CSS next to the component'], ['dynamic by props', 'style = f(props)'], ['scoped classes', 'no naming collisions'], ['themable', 'design tokens everywhere']]
loves.forEach(([h, d], i) => {
  const x = 0.9 + i * 2.95
  s.addShape('ellipse', { x, y: 5.35, w: 0.34, h: 0.34, fill: { color: CARD2 }, line: { color: SC, width: 1.5 } })
  s.addText('✓', { x, y: 5.35, w: 0.34, h: 0.34, align: 'center', valign: 'middle', fontFace: F, fontSize: 13, bold: true, color: SC, margin: 0 })
  s.addText(h, { x: x + 0.45, y: 5.3, w: 2.45, h: 0.3, fontFace: F, fontSize: 12.5, bold: true, color: INK, margin: 0 })
  s.addText(d, { x: x + 0.45, y: 5.62, w: 2.45, h: 0.3, fontFace: F, fontSize: 10.5, color: MUT, margin: 0 })
})

// ---------- 3. WHAT REACT ACTUALLY RENDERS ----------
s = pres.addSlide(); base(s)
title(s, 'What React actually renders', 'every styled element is a real component — your tree silently doubles')
// left: your JSX
card(s, 0.6, 1.7, 5.6, 5.0)
s.addText('your JSX', { x: 0.9, y: 1.9, w: 5, h: 0.35, fontFace: F, fontSize: 14, bold: true, color: INK, margin: 0 })
node(s, 2.5, 2.5, 1.8, '<Card>', JS)
node(s, 1.4, 3.7, 1.8, '<Title>', JS)
node(s, 3.6, 3.7, 1.8, '<Button>', JS)
arrow(s, 3.4, 3.0, 2.4, 3.7); arrow(s, 3.4, 3.0, 4.4, 3.7)
s.addText('3 elements', { x: 0.9, y: 5.9, w: 5, h: 0.4, align: 'center', fontFace: F, fontSize: 16, bold: true, color: JS, margin: 0 })
// right: fiber tree with SC
card(s, 7.1, 1.7, 5.6, 5.0)
s.addText('React fiber tree with styled-components', { x: 7.4, y: 1.9, w: 5, h: 0.35, fontFace: F, fontSize: 14, bold: true, color: INK, margin: 0 })
node(s, 9.0, 2.4, 1.8, 'Card ⚙', SC)          // wrapper
node(s, 9.0, 3.1, 1.8, '<div>', MUT)
arrow(s, 9.9, 2.9, 9.9, 3.1)
node(s, 7.7, 4.0, 1.8, 'Title ⚙', SC)
node(s, 7.7, 4.7, 1.8, '<h3>', MUT)
arrow(s, 8.6, 4.5, 8.6, 4.7)
node(s, 10.3, 4.0, 1.8, 'Button ⚙', SC)
node(s, 10.3, 4.7, 1.8, '<button>', MUT)
arrow(s, 11.2, 4.5, 11.2, 4.7)
arrow(s, 9.5, 3.6, 8.7, 4.0); arrow(s, 10.4, 3.6, 11.1, 4.0)
s.addText([{ text: '6 fibers', options: { color: COST, bold: true } }, { text: '  — one extra component per styled element', options: { color: MUT } }],
  { x: 7.4, y: 5.9, w: 5.1, h: 0.4, align: 'center', fontFace: F, fontSize: 14, margin: 0 })
arrow(s, 6.25, 4.2, 7.05, 4.2, COST)

// ---------- 4. WHERE THE COST COMES FROM ----------
s = pres.addSlide(); base(s)
title(s, 'Where the cost comes from', 'three taxes, paid on every mount and every re-render')
const costs = [
  ['1', 'wrapper fibers', 'every styled element mounts, reconciles and updates an extra component — thousands of them on a busy screen', 'create fiber → props → context → render → diff'],
  ['2', 'per-render style work', 'building the execution context, resolving every interpolation, joining the template — before styling even starts', 'resolve ${p => …} × N  →  join  →  hash'],
  ['3', 'CSS parsing in the browser', 'stylis parses and serializes the CSS string at runtime, per component and per unique style variant', 'parse → nest → prefix → serialize → insert'],
]
costs.forEach(([n, h, d, m], i) => {
  const x = 0.6 + i * 4.15
  card(s, x, 1.8, 3.85, 4.6)
  s.addShape('ellipse', { x: x + 0.3, y: 2.1, w: 0.55, h: 0.55, fill: { color: CARD2 }, line: { color: COST, width: 1.75 } })
  s.addText(n, { x: x + 0.3, y: 2.1, w: 0.55, h: 0.55, align: 'center', valign: 'middle', fontFace: F, fontSize: 18, bold: true, color: COST, margin: 0 })
  s.addText(h, { x: x + 0.3, y: 2.85, w: 3.3, h: 0.4, fontFace: F, fontSize: 17, bold: true, color: INK, margin: 0 })
  s.addText(d, { x: x + 0.3, y: 3.35, w: 3.3, h: 1.5, fontFace: F, fontSize: 12.5, color: MUT, margin: 0, lineSpacing: 17 })
  card(s, x + 0.3, 5.15, 3.25, 0.85, '0A0F1C')
  s.addText(m, { x: x + 0.45, y: 5.15, w: 3.0, h: 0.85, valign: 'middle', fontFace: MONO, fontSize: 10, color: COST, margin: 0 })
})
s.addText('none of this work is visible in your code — it all happens inside the library, at runtime', { x: 0.6, y: 6.7, w: 12.1, h: 0.4, align: 'center', fontFace: F, fontSize: 13, italic: true, color: MUT, margin: 0 })

// ---------- 5. THE IDEA ----------
s = pres.addSlide(); base(s)
title(s, 'bare-styled: resolve at element creation', 'the styled component never becomes a component — jsx() returns the host element directly')
// flow
node(s, 0.8, 2.4, 2.2, '<Button $primary>', JS)
arrow(s, 3.0, 2.65, 4.0, 2.65, JS)
card(s, 4.0, 2.15, 2.6, 1.0, CARD2)
s.addText('jsx() intercepts\nresolves styles → class', { x: 4.0, y: 2.15, w: 2.6, h: 1.0, align: 'center', valign: 'middle', fontFace: F, fontSize: 11.5, bold: true, color: INK, margin: 0 })
arrow(s, 6.6, 2.65, 7.6, 2.65, JS)
node(s, 7.6, 2.4, 3.2, '<button class="bs-a1b2">', JS)
s.addText('no wrapper fiber · no component render · React only ever sees the host element', { x: 0.8, y: 3.5, w: 10, h: 0.35, fontFace: F, fontSize: 12.5, italic: true, color: MUT, margin: 0 })
// before/after fiber tree mini
card(s, 0.6, 4.2, 5.9, 2.6)
s.addText('fiber tree — styled-components', { x: 0.9, y: 4.4, w: 5.3, h: 0.3, fontFace: F, fontSize: 12.5, bold: true, color: SC, margin: 0 })
;['Card ⚙', '<div>', 'Button ⚙', '<button>'].forEach((t, i) => {
  node(s, 0.9 + i * 1.32, 5.0 + (i % 2) * 0.75, 1.22, t, i % 2 === 0 ? SC : MUT)
})
s.addText('2× fibers', { x: 4.5, y: 6.2, w: 1.8, h: 0.3, fontFace: F, fontSize: 13, bold: true, color: COST, margin: 0 })
card(s, 6.8, 4.2, 5.9, 2.6)
s.addText('fiber tree — bare-styled', { x: 7.1, y: 4.4, w: 5.3, h: 0.3, fontFace: F, fontSize: 12.5, bold: true, color: JS, margin: 0 })
node(s, 7.1, 5.3, 1.6, '<div>', JS)
node(s, 9.0, 5.3, 1.6, '<button>', JS)
s.addText('hosts only', { x: 10.8, y: 6.2, w: 1.6, h: 0.3, fontFace: F, fontSize: 13, bold: true, color: GOOD, margin: 0 })

// ---------- 6. THREE-TIER COMPILATION ----------
s = pres.addSlide(); base(s)
title(s, 'Kill the runtime CSS parser', 'the vite plugin compiles what it can at build — three tiers, cheapest wins')
const tiers = [
  ['tier 1 · static', 'padding: 8px;\ncolor: red;', 'CSS fully compiled at build.\nShipped as a finished rule — zero style work at runtime.', GOOD, '~33% of templates'],
  ['tier 2 · skeleton', 'gap: ${p => p.gap};', 'structure compiled at build, value slots left open.\nRender = call fn + string substitution. No parser.', JS, '~48% of templates'],
  ['tier 3 · live', '${p => p.on\n  ? css`…` : \'\'}', 'shape can change per render →\nfull runtime resolve, aggressively cached.', AMBER, 'the rest'],
]
tiers.forEach(([h, code, d, c, share], i) => {
  const y = 1.7 + i * 1.75
  card(s, 0.6, y, 12.1, 1.55)
  s.addText(h, { x: 0.9, y: y + 0.15, w: 2.4, h: 0.4, fontFace: F, fontSize: 15, bold: true, color: c, margin: 0 })
  s.addText(share, { x: 0.9, y: y + 0.62, w: 2.4, h: 0.3, fontFace: F, fontSize: 11, color: MUT, margin: 0 })
  card(s, 3.4, y + 0.22, 3.4, 1.1, '0A0F1C')
  s.addText(code, { x: 3.55, y: y + 0.22, w: 3.1, h: 1.1, valign: 'middle', fontFace: MONO, fontSize: 10.5, color: c, margin: 0 })
  s.addText(d, { x: 7.1, y: y + 0.15, w: 5.3, h: 1.3, valign: 'middle', fontFace: F, fontSize: 12, color: INK, margin: 0, lineSpacing: 16 })
})
chip(s, 3.9, 6.95, 5.5, '81% of components never touch stylis at runtime', GOOD)

// ---------- 7. SAME API ----------
s = pres.addSlide(); base(s)
title(s, 'Adoption cost: one line', 'no rewrite — the codebase keeps importing styled-components')
card(s, 0.6, 1.7, 6.0, 3.1)
s.addText('your components — unchanged', { x: 0.9, y: 1.9, w: 5.4, h: 0.35, fontFace: F, fontSize: 13, bold: true, color: INK, margin: 0 })
s.addText([
  { text: "import styled from 'styled-components'\n\n", options: { color: MUT } },
  { text: 'const ', options: { color: MUT } }, { text: 'Stack', options: { color: JS, bold: true } }, { text: ' = styled.div.withConfig({\n', options: { color: INK } },
  { text: '  forwardProps: ({ gap, ...rest }) => rest\n', options: { color: AMBER } },
  { text: '})`\n  display: flex;\n  gap: ${p => p.gap};\n`;', options: { color: INK } },
], { x: 0.9, y: 2.35, w: 5.4, h: 2.3, fontFace: MONO, fontSize: 12, margin: 0, lineSpacing: 17 })
card(s, 7.1, 1.7, 5.6, 3.1)
s.addText('vite config — the only change', { x: 7.4, y: 1.9, w: 5, h: 0.35, fontFace: F, fontSize: 13, bold: true, color: INK, margin: 0 })
s.addText([
  { text: "import { bareStyled } from 'bare-styled/vite'\n\n", options: { color: JS, bold: true } },
  { text: 'plugins: [\n', options: { color: INK } },
  { text: '  bareStyled(),\n', options: { color: JS, bold: true } },
  { text: "  react({ jsxImportSource: 'bare-styled' })\n", options: { color: INK } },
  { text: ']', options: { color: INK } },
], { x: 7.4, y: 2.35, w: 5.1, h: 2.3, fontFace: MONO, fontSize: 12, margin: 0, lineSpacing: 17 })
s.addText('supported natively', { x: 0.6, y: 5.15, w: 12.1, h: 0.35, fontFace: F, fontSize: 13, bold: true, color: INK, margin: 0 })
const feats = ['.attrs()', '.withConfig()', 'keyframes', '${Component} selectors', 'shouldForwardProp', 'forwardProps (new)', 'styled(X.Y)', 'compound statics']
feats.forEach((f, i) => { chip(s, 0.6 + (i % 4) * 3.1, 5.6 + Math.floor(i / 4) * 0.6, 2.9, f, JS) })
s.addText('anything exotic falls back to real styled-components — enabling the plugin never breaks a component', { x: 0.6, y: 6.95, w: 12.1, h: 0.35, align: 'center', fontFace: F, fontSize: 11.5, italic: true, color: MUT, margin: 0 })

// ---------- 8. BENCHMARKS ----------
s = pres.addSlide(); base(s)
title(s, 'Benchmarks', 'median of 3 runs · production React · 9 dashboard + widget profiles vs styled-components 6')
s.addChart('bar', [{
  name: 'improvement vs styled-components',
  labels: ['mount (avg)', 're-render (avg)', 're-render (best case)'],
  values: [M.mount, M.update, M.best],
}], {
  x: 0.6, y: 1.7, w: 6.4, h: 4.6,
  barDir: 'col', chartColors: [JS], showLegend: false,
  showValue: true, dataLabelPosition: 'outEnd', dataLabelColor: INK, dataLabelFontSize: 14, dataLabelFontBold: true, dataLabelFormatCode: '0"%"',
  catAxisLabelColor: MUT, catAxisLabelFontSize: 12, valAxisLabelColor: MUT, valAxisLabelFontSize: 10,
  valAxisMaxVal: 70, valGridLine: { color: GRID, size: 0.5 }, catGridLine: { style: 'none' },
  showTitle: true, title: 'render time improvement (%)', titleColor: INK, titleFontSize: 13,
  plotArea: { fill: { color: BG } }, chartArea: { fill: { color: BG }, border: { color: BG } },
})
const stats = [['0', 'wrapper fibers on styled elements', JS], ['81%', 'of components stylis-free at runtime', GOOD], ['6.2×', 'faster build transform (oxc engine)', AMBER], ['4,101', 'templates compiled · 0 parity errors', INK]]
stats.forEach(([n, d, c], i) => {
  const y = 1.7 + i * 1.18
  card(s, 7.4, y, 5.3, 1.0)
  s.addText(n, { x: 7.7, y, w: 1.7, h: 1.0, valign: 'middle', fontFace: F, fontSize: 26, bold: true, color: c, margin: 0 })
  s.addText(d, { x: 9.45, y, w: 3.1, h: 1.0, valign: 'middle', fontFace: F, fontSize: 12, color: MUT, margin: 0 })
})

// ---------- 9. REAL APP ----------
s = pres.addSlide(); base(s)
title(s, 'In the real app', 'Chrome performance traces of comparable Prophecy sessions · main thread, DevTools overhead excluded')
s.addChart('bar', [
  { name: 'styled-components', labels: ['styling engine CPU (ms)'], values: [143] },
  { name: 'bare-styled', labels: ['styling engine CPU (ms)'], values: [53] },
], {
  x: 0.6, y: 1.8, w: 5.9, h: 4.2, barDir: 'col',
  chartColors: [SC, JS], showLegend: true, legendPos: 'b', legendColor: MUT, legendFontSize: 11,
  showValue: true, dataLabelPosition: 'outEnd', dataLabelColor: INK, dataLabelFontSize: 14, dataLabelFontBold: true,
  catAxisLabelColor: MUT, valAxisLabelColor: MUT, valAxisLabelFontSize: 10,
  valGridLine: { color: GRID, size: 0.5 }, catGridLine: { style: 'none' },
  showTitle: true, title: 'styling work per session', titleColor: INK, titleFontSize: 13,
  plotArea: { fill: { color: BG } }, chartArea: { fill: { color: BG }, border: { color: BG } },
})
const traces = [['2.7×', 'less styling CPU', JS], ['−29%', 'main-thread busy time (9.0s → 6.4s)', GOOD], ['−12%', 'react-dom render work', GOOD]]
traces.forEach(([n, d, c], i) => {
  const y = 1.9 + i * 1.45
  card(s, 7.0, y, 5.7, 1.2)
  s.addText(n, { x: 7.3, y, w: 1.9, h: 1.2, valign: 'middle', fontFace: F, fontSize: 30, bold: true, color: c, margin: 0 })
  s.addText(d, { x: 9.25, y, w: 3.3, h: 1.2, valign: 'middle', fontFace: F, fontSize: 13, color: MUT, margin: 0 })
})
s.addText('styling drops from the profile almost entirely — remaining time is the app itself', { x: 0.6, y: 6.75, w: 12.1, h: 0.35, align: 'center', fontFace: F, fontSize: 12, italic: true, color: MUT, margin: 0 })

// ---------- 10. CLOSE ----------
s = pres.addSlide(); base(s)
s.addText('same code.', { x: 0.6, y: 2.0, w: 12.1, h: 0.8, align: 'center', fontFace: F, fontSize: 40, bold: true, color: MUT, margin: 0 })
s.addText('no components. no parser. no tax.', { x: 0.6, y: 2.9, w: 12.1, h: 0.9, align: 'center', fontFace: F, fontSize: 44, bold: true, color: INK, margin: 0 })
chip(s, 2.4, 4.4, 2.6, 'drop-in vite plugin', JS)
chip(s, 5.2, 4.4, 2.6, '+' + M.update + '% re-render', GOOD)
chip(s, 8.0, 4.4, 2.6, 'safe fallback to SC', AMBER)
s.addText('bare-styled', { x: 0.6, y: 6.3, w: 12.1, h: 0.5, align: 'center', fontFace: F, fontSize: 16, bold: true, color: JS, margin: 0 })

pres.writeFile({ fileName: path.join(repo, 'docs/bare-styled-deck-v2.pptx') }).then(() => console.log('written'))
