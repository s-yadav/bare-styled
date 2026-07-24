# just-styled — session handoff

For continuing work in a fresh session. Self-contained: assume no prior context.
Last updated: July 11, 2026. State: 78 tests / 13 suites passing.

## What this is

A CSS-in-JS library (`~/github/just-styled`) that keeps styled-components'
authoring API and styling model but renders each styled component as a **plain
host element with no wrapper fiber** — resolved at JSX time, before React sees
it. Being integrated into `~/projects/prophecy-frontend1` (Vite +
`@vitejs/plugin-react` v6/oxc/Rolldown, React 18.3.1, SC 6.1.11, pnpm
monorepo). Prophecy uses `styled(StyledComponent)` composition heavily.

**Package identity (recently merged):** ONE npm package, `just-styled` v1.0.0,
at the repo ROOT. The historical fork name `babel-plugin-styled-components` is
gone. Exports map:

| Subpath | File | What |
|---|---|---|
| `.` / `./runtime` | `packages/runtime/src/index.js` | runtime (createStyled, getCss, setVendorPrefixes, __getFallbackRenders) |
| `./runtime/patch` | `packages/runtime/src/patch.js` | classic createElement monkeypatch (side-effect) |
| `./jsx-runtime`, `./jsx-dev-runtime` | `packages/runtime/src/jsx-*.js` | wrapped automatic JSX runtime (use `jsxImportSource: 'just-styled'`) |
| `./transform` | `lib/index.js` | Babel plugin (reference engine) — pass the FUNCTION to babel, never the name string (babel would normalize to `babel-plugin-just-styled`) |
| `./fast-transform` | `lib/fast-transform.js` | oxc engine (default; 8.5× faster) |
| `./vite` | `lib/vite-plugin.js` + `types/vite-plugin.d.ts` | the Vite plugin (engine selection, babel fallback, JUST_STYLED_DEBUG) |

`packages/runtime` is internally named `@just-styled/runtime` (pnpm workspace
can't have two packages named `just-styled`); nothing resolves it by name —
jest moduleNameMapper and the profiling build scripts map by path.

## Runtime model (hash-class)

- Transform rewrites `styled.tag` / `styled('tag')` / `styled(Ident)` →
  `createStyled(component, { componentId, displayName, [css] })\`tpl\`` with
  interpolations kept live. `componentId` = `sc-<fileHash>-<n>` (stable marker
  class + `${Comp}` selector target via descriptor `toString`).
- `.attrs(...)` / `.withConfig({ componentId, displayName, shouldForwardProp })`
  chains COMPILE NATIVELY (both engines; identical bail rules — unknown
  withConfig keys stay on real SC). Runtime semantics match SC: attrs OVERRIDE
  props (className joins, style merges), applied base-first across extension
  chains (`_attrsAll` precomputed at definition — per-level application would
  reverse the order); custom shouldForwardProp REPLACES the default filter and
  threads from the outermost descriptor (`_sfp`). The factory is chainable at
  runtime too. Only `css`/`keyframes`/`createGlobalStyle` helpers remain
  untouched → real styled-components (intended fallback).
- Descriptor = `React.forwardRef` object, self-referenced under
  `Symbol.for('just-styled')` (`isDescriptor: type[IS_STYLED] === type`).
  The wrapped JSX runtime resolves descriptors to host elements at
  element-creation time; the forwardRef body is only a fallback (it counts
  via `__getFallbackRenders()` and dev-warns once per component — should be 0;
  known miss paths: memo()/lazy() around a styled export, patch no-op +
  unwrapped runtime, third-party createElement when patch failed).
- **Statics passthrough:** `Object.setPrototypeOf(element, component)` for
  non-string bases so `styled(Dropdown).Item` works. MUST run AFTER own-field
  assignments — real SC v6 components carry a NON-WRITABLE `toString`, and
  strict-mode assignment through such a proto throws (hit in prophecy
  Dialog/styled.tsx).
- **SC FOLD interop:** an untransformed chain over a descriptor
  (`styled(Stack).attrs(...)`) runs on real SC, which sees styledComponentId
  and FOLDS: it renders `descriptor.target` directly — the descriptor is never
  element-created, so neither JSX interception nor the forwardRef fallback
  runs. The descriptor therefore carries the fold contract as OWN fields:
  `attrs: []`, `foldedComponentIds: []`, and a `componentStyle` shim whose
  `generateAndInjectStyles(executionContext)` calls
  `patchImpl.styleClassesFor(element, ctx)` — static registers under
  componentId, dynamic resolves against SC's merged execution context into our
  hash class. Without this, dynamic base styles were silently DROPPED
  (user-reported bug). Verified on SC 6.4.3 AND 6.1.11 (isolated /tmp harness
  with single React). Cross-sheet cascade ties with the SC wrapper's own rules
  remain the documented limitation.
- **Static tiers:** build-precompiled (`css:` in config — zero-interp, const
  members via custom resolver, same-file `${Component}` selectors, same-file
  static css`` fragments, string/number `+`) → **SKELETON** (`skeleton` +
  `vars` in config: residual interpolations all in declaration-VALUE position;
  stylis ran at BUILD over a `__jsc__` class token + `var(--js-N)` value
  placeholders; render = fn calls → short joined-value cache key ('\x1f'
  separated) → segment stitch, never stylis; non-fn vars substitute at
  definition and zero-fn skeletons promote to fully static; brace-bearing
  values renormalize through stylis for well-formedness) → runtime-static
  (flatten via SC's css() at definition; stylis in requestIdleCallback) →
  live/dynamic (block/selector-position residuals only: resolve per render →
  per-component hash class, cached). Value-position classification lives in
  the SHARED src/utils/value-positions.js scanner — both engines must keep
  using it identically. Corpus: 81% of prophecy styled components (static +
  skeleton) never run stylis at render.
- **Sheet** (`packages/runtime/src/sheet.js`): group-ordered — every component
  takes a definition-order group (`engine.nextGroup()`); rules insert
  positionally at their group's end (Fenwick tree for O(log G) offsets), so
  base rules always precede `styled(Component)` extender rules regardless of
  render order. No cross-component dedup (a rule belongs to one group; matches
  SC). CSSOM `insertRule` into `<style data-just-styled>`; rejected rules go
  to a SEPARATE `<style data-just-styled-fallback>` (text on the main element
  would re-parse it and wipe the CSSOM sheet — was a severe bug).
- **Keyframes ARE supported:** resolveValue duck-types Keyframes
  (`{name, rules, getName}`, identical across SC v5/v6 and duplicate copies),
  injects `@keyframes <name>` once (own lazy group, cached by name), returns
  the name. cacheParts also try/catches SC's css() (cross-copy foreign objects
  can make it throw) and falls back to naive string/interp interleave.
- **Vendor prefixing OFF by default** (SC v6 parity): runtime
  `setVendorPrefixes(true)` + plugin `vendorPrefixes: true` must be paired.
- Flat dynamic bodies (no `{ } & @ /`) skip stylis entirely (~206ns vs
  ~1345ns); `/` excluded because stylis strips `//` comments.
- NOT supported: ThemeProvider/context theme (`props.theme` undefined; throw
  swallowed, interpolation drops — use module-scope theme constants, or
  `.withConfig({})` to stay on SC). Cross-sheet ordering with SC-fallback
  rules is uncoordinated (rare).

## Transform engines

Two equivalent engines, differential-tested on the prophecy corpus (276
styled files): 969/969 compiled, 259/259 build-precompiled, css
byte-equivalent (only diff: babel escapes non-ASCII as \uXXXX — decodes
identically).

- **oxc engine** (`src/fast-transform.js`, default): oxc-parser (ESTree AST)
  + magic-string surgical edits. **0.68 vs 5.78 ms/file — 8.5×.** Same
  fileHash → same componentIds as babel. Conservative deltas (all degrade to
  "leave on real SC" or "runtime-static instead of precompiled", never wrong
  output): module-scope templates only (function-scope skipped), no `styled`
  re-binding follow, staticValue narrower than babel's evaluate() (no
  conditionals-of-consts etc.). componentId numbering can shift between
  engines when a file has function-scope styled (positional `-n`).
- **babel engine** (`src/js-transform.js`): reference implementation.
  STYLED_IDS map keyed by declarator NODE (shadowing-proof); resolveMember for
  const member chains (babel's evaluate deopts there); bails when any quasi
  `cooked == null` (invalid escapes — would otherwise emit an EMPTY rule).
- oxc-parser is ESM; Node ≥22.12 `require(esm)` handles it, jest can't →
  fallback `vendor/oxc-parser.cjs` (esbuild CJS bundle, binding external;
  regenerate with `node scripts/bundle-oxc.js` after oxc bumps;
  import.meta.url handled via define+banner).
- Vite plugin (`src/vite-plugin.js` → `just-styled/vite`): gate
  `/\bstyled\s*[.(\`<]/` → oxc engine → per-file babel fallback on throw.
  Lazy loads everything; @babel/core is an optional peer. Types are
  hand-maintained in `types/vite-plugin.d.ts` (structural, no vite dep).

## Prophecy integration state

- `package.json`: ONE link — `"just-styled": "link:../../github/just-styled"`
  (dependencies). Old runtime link + `babel-plugin-styled-components` devDep
  REMOVED.
- `frontend/vite.config.ts`: `import { justStyled } from 'just-styled/vite'`;
  `justStyled({ displayName: !isProd })`;
  `react({ jsxImportSource: 'just-styled' })`; `resolve.dedupe` includes
  react* AND `styled-components` (dup-SC caused the keyframes crash:
  runtime's css() from checkout's 6.4.3 failed `instanceof` on prophecy's
  6.1.11 Keyframes → uncaught Keyframes.toString throw at module eval);
  optimizeDeps includes just-styled + subpath entries; `@prophecy/ui-v3`
  aliased to src in all modes (its tsc build never runs the transform).
- `frontend/scripts/just-styled-plugin.ts`: now a re-export shim → `git rm`
  candidate.
- `JUST_STYLED_INTEGRATION.md`: current (rewritten for hash-class model,
  keyframes support, single link, engine docs).
- **Vite gotcha:** the runtime is pre-bundled (optimizeDeps), and the
  pre-bundle does NOT self-invalidate for `link:` deps — after ANY runtime
  source change: `rm -rf frontend/node_modules/.vite` + full dev restart.

## Perf numbers (jsdom, production React, medians; ±4pts noise)

Mount +19–29% / re-render +37–54% vs styled-components across all 9 profiles
(dashboard 150r mixed/static/dynamic; widget 60×5 & 200×8 × few/static/unique
tint). Static-heavy re-render ≈ +45–51%; high-cardinality unique ≈ +54% (flat
stylis skip). All-dynamic low-cardinality is the floor (+37%, by design —
per-render resolution matches SC's algorithm). Presentable report:
`docs/perf-report.html` (self-contained, Chart.js CDN);
`docs/STATUS-REPORT-2026-07.md` (prose). Benchmarks:
`npx jest test/perf` with env DASH_MODE=mixed|static|dynamic,
WIDGET_TINT=few|static|unique, *_ROWS/*_ITERS; browser harnesses
`profiling/{dashboard,widget}/harness.html` (rebuild:
`node profiling/<x>/build.mjs`; Δ% columns freeze at insertion).

## Test map (78 tests / 13 suites)

`test/js-transform.test.js` (babel emit incl. precompile/vendorPrefixes/escape
bail), `test/fast-transform.test.js` (differential vs babel + e2e render),
`test/runtime/{descriptor,patch,sheet,sheet.dom,folding,idle-precompile}.test.js`
(folding.test.js actually holds ORDERING tests — `git mv` to ordering.test.js
pending), `test/e2e/{pipeline,runtime-scenarios}.test.js`,
`test/perf/{dashboard,widget,tint-cardinality}*`. Note: flat-body fast path
preserves template whitespace (tests are whitespace-tolerant there).

## Pending / user-machine-only steps

1. `cd ~/github/just-styled && pnpm install` (new deps: oxc-parser,
   magic-string, @babel/plugin-syntax-typescript promoted to deps;
   @emotion/is-prop-valid now root dep) — then `pnpm build`.
2. `cd ~/projects/prophecy-frontend1 && pnpm install` (link rewiring) then
   `rm -rf frontend/node_modules/.vite` then
   `JUST_STYLED_DEBUG=1 pnpm --filter frontend start`.
3. Smoke checklist: elements carry `sc-*` (static) / `sc-* js-*` (dynamic)
   classes; `<style data-just-styled>` in head; no wrapper components in React
   DevTools; console free of `[just-styled] ... forwardRef fallback` warnings;
   `.attrs`/`.withConfig` components unchanged (SC classes).
4. git housekeeping (sandbox cannot delete files): `git rm` dead stubs
   (`packages/runtime/src/flatten.js`, skipped e2e tests, old
   babel-plugin-styled-components visitors if any remain), `git mv
   test/runtime/folding.test.js test/runtime/ordering.test.js`, `git rm
   frontend/scripts/just-styled-plugin.ts` (prophecy) once nothing imports it.
5. Possible next work: `packages/theme` src-alias treatment (styled defs in
   theme package currently uncompiled in prod); browser-harness DevTools
   recording for recalc/layout numbers; `groupStart` etc. only if profiling
   demands more.

## Sandbox environment facts (critical if working in Cowork again)

- Mounts: just-styled and prophecy-frontend1 both mounted; bash paths differ
  from file-tool paths (see session env). **The mount BLOCKS file deletion**
  (rm/unlink/rename-aside all EPERM) — only overwrite/truncate work. Dead
  files must be git-rm'd on the real machine.
- **npm cannot install INTO the mount** (ENOTEMPTY on rename-aside; a crashed
  attempt once TRUNCATED random node_modules files — glob.js 0 bytes,
  minimatch cut mid-file, "Cannot find module 'gensync'", SIGBUS from a
  corrupt .node binary). Repair recipe: full `npm install` into /tmp
  (`/tmp/jsrepo`) from the repo's package.json, then
  `cp -rf node_modules/. <mount>/node_modules/`.
- Run babel builds via `node node_modules/@babel/cli/bin/babel.js src -d lib`
  (npx sometimes resolves a stale wrong `babel` package).
- jest: `npx jest` works; oxc loads via vendor/oxc-parser.cjs there.
- prophecy's link symlinks resolve on the user's machine layout
  (`../../github/just-styled`), NOT inside the sandbox mounts — test package
  resolution via a /tmp consumer dir with a manual symlink instead.
- styled-components versions: prophecy 6.1.11, fork repo 6.4.3 — SC 6.1
  defines non-writable toString on components; SC v6 does NOT vendor-prefix.
