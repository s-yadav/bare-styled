// bare-styled fast transform — oxc-parser + magic-string. Functionally
// equivalent to the Babel plugin but ~an order of magnitude faster: one oxc
// parse, surgical string splices. Deliberate scope vs Babel (bail is always
// safe — the template just stays live or the caller falls back to Babel):
// module-scope templates only (function scope needs real shadowing analysis),
// `styled` re-bindings not followed, static resolution slightly narrower than
// babel's evaluate() (costs a precompile, never correctness).
import fs from 'fs'
import path from 'path'
import { compile, serialize, stringify, middleware, prefixer } from 'stylis'
import hash from './utils/hash'
import prefixLeadingDigit from './utils/prefixDigit'
import { createScanner } from './utils/value-positions'

const MAX_STATIC_DEPTH = 8

// ---- per-file hash (same scheme as the Babel plugin's getFileHash) ----------
const fileHashCache = new Map()
const findModuleRoot = dir => {
  if (!dir) return null
  if (fs.existsSync(path.join(dir, 'package.json'))) return dir
  const parent = path.dirname(dir)
  return parent === dir ? null : findModuleRoot(parent)
}
function getFileHash(filename, code) {
  const cached = fileHashCache.get(filename)
  if (cached) return cached
  const moduleRoot = filename ? findModuleRoot(path.dirname(filename)) : null
  const filePath = moduleRoot && path.relative(moduleRoot, filename).split(path.sep).join('/')
  let moduleName = null
  if (moduleRoot) {
    try {
      moduleName = JSON.parse(fs.readFileSync(path.join(moduleRoot, 'package.json'))).name
    } catch (e) {
      moduleName = null
    }
  }
  const h = hash([moduleName, filePath || code].join(''))
  if (filename) fileHashCache.set(filename, h)
  return h
}

// oxc-parser is ESM; CJS-only module systems (jest) can't evaluate it — fall
// back to the vendored CJS bundle (vendor/oxc-parser.cjs, scripts/bundle-oxc.js).
let parseSync = null
function ensureParser() {
  if (parseSync) return
  let mod
  try {
    mod = require('oxc-parser')
  } catch (e) {
    mod = require('../vendor/oxc-parser.cjs')
  }
  parseSync = mod.parseSync || (mod.default && mod.default.parseSync)
  if (typeof parseSync !== 'function') {
    throw new Error('bare-styled fast-transform: could not load oxc-parser (is it installed?)')
  }
}

const isIdent = n => n && n.type === 'Identifier'
const isLit = n => n && n.type === 'Literal'

// Program-level scan: styled/css import locals + module-scope const table.
function scanModuleScope(program, importMatches) {
  const styledNames = new Set()
  const cssNames = new Set()
  const consts = new Map() // name -> init node
  for (const stmt of program.body) {
    if (stmt.type === 'ImportDeclaration') {
      if (!importMatches(stmt.source.value)) continue
      for (const spec of stmt.specifiers) {
        if (spec.type === 'ImportDefaultSpecifier') styledNames.add(spec.local.name)
        else if (spec.type === 'ImportSpecifier') {
          if (spec.imported && spec.imported.name === 'styled') styledNames.add(spec.local.name)
          if (spec.imported && spec.imported.name === 'css') cssNames.add(spec.local.name)
        }
      }
    } else if (stmt.type === 'VariableDeclaration' && stmt.kind === 'const') {
      for (const d of stmt.declarations) {
        if (isIdent(d.id) && d.init) consts.set(d.id.name, d.init)
      }
    } else if (
      stmt.type === 'ExportNamedDeclaration' &&
      stmt.declaration &&
      stmt.declaration.type === 'VariableDeclaration' &&
      stmt.declaration.kind === 'const'
    ) {
      for (const d of stmt.declaration.declarations) {
        if (isIdent(d.id) && d.init) consts.set(d.id.name, d.init)
      }
    }
  }
  return { styledNames, cssNames, consts }
}

// ---- static resolution (mirrors js-transform's litValue/resolveMember/etc) ---
function litValue(node, ctx, depth) {
  if (!node) return { ok: false }
  if (isLit(node)) return { ok: true, value: node.value }
  if (node.type === 'TemplateLiteral' && node.expressions.length === 0) {
    const cooked = node.quasis[0] && node.quasis[0].value.cooked
    return cooked == null ? { ok: false } : { ok: true, value: cooked }
  }
  if (isIdent(node)) {
    const init = ctx.consts.get(node.name)
    if (init) return litValue(init, ctx, depth)
  }
  return { ok: false }
}

function resolveMember(node, ctx) {
  const keys = []
  let cur = node
  while (cur.type === 'MemberExpression') {
    if (!cur.computed && isIdent(cur.property)) keys.unshift(cur.property.name)
    else if (cur.computed && isLit(cur.property) && typeof cur.property.value === 'string')
      keys.unshift(cur.property.value)
    else return { confident: false }
    cur = cur.object
  }
  if (!isIdent(cur)) return { confident: false }
  let obj = ctx.consts.get(cur.name)
  for (const key of keys) {
    if (!obj || obj.type !== 'ObjectExpression') return { confident: false }
    let next
    for (const prop of obj.properties) {
      if (prop.type !== 'Property' || prop.computed) continue
      const name = isIdent(prop.key) ? prop.key.name : isLit(prop.key) ? prop.key.value : null
      if (name === key) {
        next = prop.value
        break
      }
    }
    if (next === undefined) return { confident: false }
    obj = next
  }
  const lit = litValue(obj, ctx, 0)
  return lit.ok ? { confident: true, value: lit.value } : { confident: false }
}

function staticValue(node, ctx, depth) {
  if (depth >= MAX_STATIC_DEPTH) return { confident: false }
  if (isLit(node)) return { confident: true, value: node.value }
  if (node.type === 'TemplateLiteral' && node.expressions.length === 0) {
    const cooked = node.quasis[0] && node.quasis[0].value.cooked
    return cooked == null ? { confident: false } : { confident: true, value: cooked }
  }
  if (node.type === 'BinaryExpression' && node.operator === '+') {
    const l = staticValue(node.left, ctx, depth + 1)
    if (!l.confident) return { confident: false }
    const r = staticValue(node.right, ctx, depth + 1)
    if (!r.confident) return { confident: false }
    const lv = l.value
    const rv = r.value
    const okType = v => typeof v === 'string' || typeof v === 'number'
    if (!okType(lv) || !okType(rv)) return { confident: false }
    return { confident: true, value: lv + rv }
  }
  if (node.type === 'MemberExpression') return resolveMember(node, ctx)
  if (isIdent(node)) {
    // same-file ${Component} selector — resolves to its componentId marker
    const componentId = ctx.styledIds.get(node.name)
    if (componentId) return { confident: true, value: '.' + componentId }
    const init = ctx.consts.get(node.name)
    if (init) {
      // same-file fully-static css`` fragment — inline its raw text
      if (
        init.type === 'TaggedTemplateExpression' &&
        isIdent(init.tag) &&
        ctx.cssNames.has(init.tag.name)
      ) {
        const raw = staticRawOfTemplate(init.quasi, ctx, depth + 1)
        if (raw != null) return { confident: true, value: raw }
        return { confident: false }
      }
      const lit = litValue(init, ctx, depth)
      return lit.ok ? { confident: true, value: lit.value } : { confident: false }
    }
  }
  return { confident: false }
}

// Raw CSS text of a template if fully static; null = dynamic, leave live.
// (Used for css`` fragment inlining, which requires full staticness.)
function staticRawOfTemplate(quasi, ctx, depth) {
  const quasis = quasi.quasis
  const exprs = quasi.expressions
  for (let i = 0; i < quasis.length; i++) {
    if (quasis[i].value.cooked == null) return null // invalid escape -> live
  }
  let raw = (quasis[0] && quasis[0].value.cooked) || ''
  if (exprs.length === 0) return raw
  // Const-table resolution is only shadowing-safe at module scope.
  if (!ctx.atModuleScope) return null
  for (let i = 0; i < exprs.length; i++) {
    const r = staticValue(exprs[i], ctx, depth)
    if (!r.confident) return null
    const v = r.value
    let piece
    if (typeof v === 'string') piece = v
    else if (typeof v === 'number') piece = String(v)
    else if (v === false || v === null || v === undefined || v === '') piece = ''
    else return null
    raw += piece + ((quasis[i + 1] && quasis[i + 1].value.cooked) || '')
  }
  return raw
}

// Template analysis — MUST match the Babel engine's analyzeTemplate.
// static / skeleton (VALUE-position residuals -> var(--bs-N)) / live
// (block/selector-position residual).
function analyzeTemplate(quasi, ctx) {
  const quasis = quasi.quasis
  const exprs = quasi.expressions
  for (let i = 0; i < quasis.length; i++) {
    if (quasis[i].value.cooked == null) return { kind: 'live' } // invalid escape
  }
  const scanner = createScanner()
  let raw = (quasis[0] && quasis[0].value.cooked) || ''
  scanner.feed(raw)
  const vars = []
  for (let i = 0; i < exprs.length; i++) {
    const r = staticValue(exprs[i], ctx, 0)
    if (r.confident) {
      const v = r.value
      let piece
      if (typeof v === 'string') piece = v
      else if (typeof v === 'number') piece = String(v)
      else if (v === false || v === null || v === undefined || v === '') piece = ''
      else return { kind: 'live' }
      raw += piece
      scanner.feed(piece)
    } else if (scanner.inValue()) {
      raw += 'var(--bs-' + vars.length + ')'
      vars.push(exprs[i])
    } else {
      return { kind: 'live' }
    }
    const nxt = (quasis[i + 1] && quasis[i + 1].value.cooked) || ''
    raw += nxt
    scanner.feed(nxt)
  }
  if (vars.length === 0) return { kind: 'static', raw }
  return { kind: 'skeleton', raw, vars }
}

// A non-computed identifier chain: Dropdown.Item, A.B.C.
function isSimpleMemberChain(node) {
  while (node.type === 'MemberExpression' && !node.computed && isIdent(node.property)) {
    node = node.object
  }
  return isIdent(node)
}

// Unwrap TS expression wrappers between chain links or around the whole tag:
// `styled(X)<T>` / `.withConfig({...})<T>` / casts / parens.
function unwrapTsWrappers(node) {
  while (
    node &&
    (node.type === 'TSInstantiationExpression' ||
      node.type === 'TSAsExpression' ||
      node.type === 'TSNonNullExpression' ||
      node.type === 'ParenthesizedExpression')
  ) {
    node = node.expression
  }
  return node
}

// Parse the simple styled form + .attrs/.withConfig chain links. Bail rules
// IDENTICAL to the Babel engine's parseChain so both transform the same set.
function parseChain(tagIn, styledNames) {
  let tag = unwrapTsWrappers(tagIn)
  const attrs = [] // arg NODES, collected outer-first, reversed below
  let withConfig = null
  while (
    tag.type === 'CallExpression' &&
    tag.callee.type === 'MemberExpression' &&
    !tag.callee.computed &&
    isIdent(tag.callee.property) &&
    (tag.callee.property.name === 'attrs' || tag.callee.property.name === 'withConfig') &&
    tag.arguments.length === 1
  ) {
    const arg = tag.arguments[0]
    if (tag.callee.property.name === 'attrs') {
      attrs.push(arg)
    } else {
      if (withConfig || arg.type !== 'ObjectExpression') return null
      withConfig = arg
    }
    tag = unwrapTsWrappers(tag.callee.object)
  }

  let component = null
  if (
    tag.type === 'MemberExpression' &&
    !tag.computed &&
    isIdent(tag.object) &&
    styledNames.has(tag.object.name) &&
    isIdent(tag.property)
  ) {
    component = { kind: 'tag', name: tag.property.name }
  } else if (
    tag.type === 'CallExpression' &&
    isIdent(tag.callee) &&
    styledNames.has(tag.callee.name) &&
    tag.arguments.length === 1
  ) {
    // TS wrappers around the argument (styled(Tree<T>)) unwrap; member chains
    // (styled(Dropdown.Item)) ride along as source slices.
    const arg = unwrapTsWrappers(tag.arguments[0])
    if (isLit(arg) && typeof arg.value === 'string') component = { kind: 'tag', name: arg.value }
    else if (isIdent(arg)) component = { kind: 'ident', name: arg.name, node: arg }
    else if (isSimpleMemberChain(arg)) component = { kind: 'ident', name: null, node: arg }
  }
  if (!component) return null

  let componentId
  let displayName
  let shouldForwardProp
  let forwardProps
  if (withConfig) {
    for (const prop of withConfig.properties) {
      if (prop.type !== 'Property' || prop.computed) return null
      const key = isIdent(prop.key) ? prop.key.name : isLit(prop.key) ? prop.key.value : null
      if (key === 'componentId') {
        if (!isLit(prop.value) || typeof prop.value.value !== 'string') return null
        componentId = prop.value.value
      } else if (key === 'displayName') {
        if (!isLit(prop.value) || typeof prop.value.value !== 'string') return null
        displayName = prop.value.value
      } else if (key === 'shouldForwardProp') {
        shouldForwardProp = prop.value
      } else if (key === 'forwardProps') {
        // bare-styled extension: one call shaping all element props.
        forwardProps = prop.value
      } else {
        return null // unknown withConfig option -> real styled-components
      }
    }
  }
  attrs.reverse() // application order
  return { component, attrs, componentId, displayName, shouldForwardProp, forwardProps }
}

// Leftmost identifier of a tag chain (styled.div.withConfig(...) -> styled),
// to tell "styled template that BAILED" apart from unrelated tagged templates.
function chainRootName(tagIn) {
  let node = unwrapTsWrappers(tagIn)
  for (;;) {
    if (node.type === 'CallExpression') node = unwrapTsWrappers(node.callee)
    else if (node.type === 'MemberExpression') node = unwrapTsWrappers(node.object)
    else break
  }
  return isIdent(node) ? node.name : null
}

// Walk the AST collecting styled tagged templates IN SOURCE ORDER, tracking
// function depth (module-scope check) and the enclosing declarator name.
const SKIP_KEYS = { type: 1, start: 1, end: 1, loc: 1, range: 1 }
function collectTargets(program, styledNames) {
  const found = []
  found.bailed = [] // styled templates left on real styled-components
  const FN = {
    FunctionDeclaration: 1,
    FunctionExpression: 1,
    ArrowFunctionExpression: 1,
    ClassBody: 1,
  }
  function visit(node, fnDepth, nameHint) {
    if (node.type === 'TaggedTemplateExpression') {
      const parsed = parseChain(node.tag, styledNames)
      if (!parsed) {
        const root = chainRootName(node.tag)
        if (root && styledNames.has(root)) found.bailed.push(nameHint || '(anonymous)')
      }
      if (parsed) {
        found.push({
          node: node,
          tag: node.tag,
          quasi: node.quasi,
          component: parsed.component,
          attrs: parsed.attrs,
          cfgComponentId: parsed.componentId,
          cfgDisplayName: parsed.displayName,
          shouldForwardProp: parsed.shouldForwardProp,
          forwardProps: parsed.forwardProps,
          fnDepth,
          nameHint,
        })
      }
    }
    const nextDepth = FN[node.type] ? fnDepth + 1 : fnDepth
    for (const key in node) {
      if (SKIP_KEYS[key]) continue
      const v = node[key]
      if (Array.isArray(v)) {
        for (const c of v) {
          if (c && typeof c.type === 'string') {
            visit(c, nextDepth, hintFor(c, nameHint))
          }
        }
      } else if (v && typeof v.type === 'string') {
        visit(v, nextDepth, hintFor(node, nameHint))
      }
    }
  }
  function hintFor(node, inherited) {
    if (node.type === 'VariableDeclarator' && isIdent(node.id)) return node.id.name
    if (node.type === 'AssignmentExpression' && isIdent(node.left)) return node.left.name
    if (node.type === 'Property' && isIdent(node.key)) return node.key.name
    return inherited
  }
  visit(program, 0, undefined)
  return found
}

// ---- the transform ------------------------------------------------------------
// Returns { code, map } or null (no styled usage / nothing transformed).
export function fastTransform(code, options = {}) {
  const {
    filename = 'unknown.js',
    displayName: useDisplayName = true,
    vendorPrefixes = false,
    topLevelImportPaths = [],
    runtimeImportPath = 'bare-styled/runtime',
    namespace = '',
    meaninglessFileNames = ['index'],
  } = options

  ensureParser()
  const MagicString = require('magic-string')

  const parsed = parseSync(filename, code)
  if (parsed.errors && parsed.errors.length) {
    const err = new Error(
      'bare-styled fast-transform parse error: ' +
        (parsed.errors[0].message || String(parsed.errors[0]))
    )
    err.parseErrors = parsed.errors
    throw err
  }
  const program = typeof parsed.program === 'string' ? JSON.parse(parsed.program) : parsed.program

  let importMatches
  if (topLevelImportPaths.length) {
    const pm = require('picomatch')
    const matchers = topLevelImportPaths.map(p => pm(p))
    importMatches = v => v === 'styled-components' || matchers.some(m => m(v))
  } else {
    importMatches = v => v === 'styled-components'
  }

  const { styledNames, cssNames, consts } = scanModuleScope(program, importMatches)
  if (styledNames.size === 0) return null

  const targets = collectTargets(program, styledNames)
  if (targets.length === 0) return null

  const fileHash = getFileHash(filename, code)
  const nsPrefix = namespace ? namespace + '__' : ''
  const base = path.basename(filename, path.extname(filename))
  const blockName = meaninglessFileNames.includes(base)
    ? path.basename(path.dirname(filename))
    : base

  const s = new MagicString(code)
  const styledIds = new Map() // module-scope declarator name -> componentId
  const mkCtx = atModuleScope => ({ consts, cssNames, styledIds, atModuleScope })

  // Collision-safe local for the injected import.
  let createLocal = '_createStyled'
  while (code.includes(createLocal)) createLocal += '$'

  let position = 0
  let transformed = 0
  for (const t of targets) {
    // Function-scope templates need real scope analysis — leave them be.
    if (t.fnDepth > 0) continue

    // withConfig componentId wins over the minted one (SC semantics).
    const componentId = t.cfgComponentId || `${nsPrefix}sc-${fileHash}-${position++}`
    const props = ['componentId: ' + JSON.stringify(componentId)]

    if (useDisplayName) {
      const componentName = t.nameHint
      const dn =
        t.cfgDisplayName ||
        (componentName
          ? blockName === componentName
            ? componentName
            : `${prefixLeadingDigit(blockName)}__${componentName}`
          : prefixLeadingDigit(blockName))
      if (dn) props.push('displayName: ' + JSON.stringify(dn.replace(/[^_a-zA-Z0-9-]/g, '')))
    }

    // attrs / shouldForwardProp / forwardProps ride along as SOURCE SLICES
    // (still evaluated at module scope, in application order).
    if (t.attrs && t.attrs.length) {
      props.push(
        'attrs: [' + t.attrs.map(a => code.slice(a.start, a.end)).join(', ') + ']'
      )
    }
    if (t.shouldForwardProp) {
      props.push(
        'shouldForwardProp: ' + code.slice(t.shouldForwardProp.start, t.shouldForwardProp.end)
      )
    }
    if (t.forwardProps) {
      props.push('forwardProps: ' + code.slice(t.forwardProps.start, t.forwardProps.end))
    }

    // Build-time compilation, identical policy to the Babel plugin:
    // static -> `css`; skeleton -> `skeleton` + `vars`; else live.
    const mw = middleware(vendorPrefixes ? [prefixer, stringify] : [stringify])
    const analysis = analyzeTemplate(t.quasi, mkCtx(true))
    if (analysis.kind === 'static') {
      const compiled = serialize(compile('.' + componentId + '{' + analysis.raw + '}'), mw)
      props.push('css: ' + JSON.stringify(compiled))
      s.overwrite(t.quasi.start, t.quasi.end, '``')
    } else if (analysis.kind === 'skeleton') {
      const compiled = serialize(compile('.__bsc__{' + analysis.raw + '}'), mw)
      props.push('skeleton: ' + JSON.stringify(compiled))
      props.push('vars: [' + analysis.vars.map(v => code.slice(v.start, v.end)).join(', ') + ']')
      s.overwrite(t.quasi.start, t.quasi.end, '``')
    }

    // Record `const Name = styled...` so later same-file templates can resolve
    // `${Name}` to this componentId at build time.
    if (t.nameHint) styledIds.set(t.nameHint, componentId)

    const componentText =
      t.component.kind === 'tag'
        ? JSON.stringify(t.component.name)
        : code.slice(t.component.node.start, t.component.node.end)
    s.overwrite(t.tag.start, t.tag.end, `${createLocal}(${componentText}, { ${props.join(', ')} })`)
    transformed++
  }

  if (transformed === 0) return null

  // Inject imports after any leading directives ('use client' etc).
  let insertAt = 0
  for (const stmt of program.body) {
    if (
      stmt.type === 'ExpressionStatement' &&
      stmt.expression &&
      stmt.expression.type === 'Literal' &&
      typeof stmt.expression.value === 'string'
    ) {
      insertAt = stmt.end
      continue
    }
    break
  }
  const importText =
    `\nimport { createStyled as ${createLocal} } from ${JSON.stringify(runtimeImportPath)};` +
    `\nimport ${JSON.stringify(runtimeImportPath + '/patch')};\n`
  if (insertAt === 0) s.prepend(importText.slice(1))
  else s.appendRight(insertAt, importText)

  return {
    code: s.toString(),
    map: s.generateMap({ source: filename, hires: 'boundary' }),
    stats: {
      compiled: transformed,
      // styled templates left on real styled-components: unknown/exotic chain
      // shapes (unknown withConfig keys, non-literal ids, ...) and
      // function-scope definitions. A non-empty list in a file that ALSO
      // compiles descriptors means MIXED rendering — cross-sheet cascade ties
      // between styled-components and bare-styled are not ordered, so
      // overrides between the two halves may not apply.
      bailed: targets.bailed,
      fnScoped: targets.filter(t => t.fnDepth > 0).map(t => t.nameHint || '(anonymous)'),
    },
  }
}

export default fastTransform
