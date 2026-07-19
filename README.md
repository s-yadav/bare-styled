# just-styled

styled-components without the wrapper fiber.

just-styled keeps the styled-components authoring API and styling model — hash
classes, cascade semantics, `styled(Component)` composition, keyframes — but
resolves every styled component to a **plain host element at JSX time**, so
there is no wrapper component in the React tree. Templates that are provably
static are compiled to finished CSS **at build time**.

Measured against real styled-components on identical trees: ~19–29% faster
mount and ~37–54% faster re-render (see `docs/perf-report.html`).

## One package, two halves

- **Runtime** — `just-styled` / `just-styled/runtime`, plus
  `just-styled/jsx-runtime` + `just-styled/jsx-dev-runtime` (point your
  bundler's automatic JSX runtime at `just-styled`) and
  `just-styled/runtime/patch` (classic `React.createElement` coverage).
- **Transform** — two equivalent engines:
  - `just-styled/fast-transform` — oxc-parser + magic-string. ~8.5× faster
    than the Babel engine (≈0.7 ms/file); surgical edits, the rest of the file
    untouched byte-for-byte. Use this in bundler plugins.
  - `just-styled/transform` — the Babel plugin (reference implementation;
    also covers function-scope styled definitions, which the fast engine
    conservatively skips). Pass the imported function to Babel — a bare name
    string would be normalized to `babel-plugin-just-styled`.

## Usage (Vite + oxc example)

```ts
import { fastTransform } from 'just-styled/fast-transform';

// enforce: 'pre' plugin, before @vitejs/plugin-react
{
  name: 'just-styled',
  enforce: 'pre',
  transform(code, id) {
    if (!/\.[jt]sx?$/.test(id) || !/\bstyled\s*[.(`<]/.test(code)) return null;
    return fastTransform(code, { filename: id });
  }
}

// and route JSX through the wrapped runtime:
react({ jsxImportSource: 'just-styled' })
```

Options (both engines): `displayName` (default true), `vendorPrefixes`
(default false — styled-components v6 parity; pair with
`setVendorPrefixes(true)` from the runtime), `topLevelImportPaths`,
`runtimeImportPath`, `namespace`.

## What compiles

`styled.tag`, `styled('tag')`, `styled(Component)`. Templates that are fully
static after resolving module constants, const member chains
(`${theme.border}`), same-file `${Component}` selectors and same-file static
`css` fragments ship as precompiled CSS — zero runtime style work.
`.attrs(...)` / `.withConfig(...)` chains and the `css` / `keyframes` /
`createGlobalStyle` helpers are left untouched and run on real
styled-components (the intended fallback).

## Known limitations

- No `ThemeProvider` / context theme (a host element can't read React
  context) — use module-scope theme constants, or keep a component on the
  styled-components fallback via any chain (e.g. `.withConfig({})`).
- Cross-sheet cascade ordering between just-styled rules and
  styled-components-fallback rules is not coordinated.

## Development

```bash
pnpm install
pnpm build                        # babel src -d lib (both transform engines)
pnpm test                         # jest
node scripts/bundle-oxc.js        # regenerate vendor/oxc-parser.cjs after oxc bumps
node profiling/dashboard/build.mjs  # browser perf harness (then open harness.html)
```

History: the transform machinery was originally forked from
[babel-plugin-styled-components](https://github.com/styled-components/babel-plugin-styled-components)
(MIT); it has since been decoupled and rewritten around the descriptor /
hash-class model, with the oxc engine replacing Babel on the hot path.
