<p align="center">
  <img src="./assets/logo.svg" alt="bare-styled — styled-components, without components" width="560" />
</p>

# bare-styled

**styled-components, without components.**

bare-styled keeps the styled-components API — the same imports, templates, and
cascade semantics — but removes the runtime that makes it slow. Styled
components are resolved to **plain host elements at JSX time** (no wrapper
component in the React tree), and their CSS is compiled **at build time**
wherever possible, so most components never touch a CSS parser in the browser.

Measured against styled-components 6 on identical trees: **~24% faster mount,
~45% faster re-render** on average, up to **58%** on dynamic-heavy screens
(median of repeated runs across nine profiles — see `docs/perf-report.html`).
In a production app trace, styling CPU dropped 2.7×.

```jsx
import styled from 'styled-components'; // unchanged

const Button = styled.button`
  padding: 8px 16px;
  background: ${p => (p.$primary ? '#e9679c' : '#1d2a4a')};
`;

<Button $primary>Save</Button>
// React renders: <button class="sc-x bs-a1b2">  — no wrapper fiber
```

## Quick start (Vite)

```ts
// vite.config.ts
import { bareStyled } from 'bare-styled/vite';
import react from '@vitejs/plugin-react';

export default {
  plugins: [
    bareStyled(), // enforce: 'pre' — must come before react()
    react({ jsxImportSource: 'bare-styled' }),
  ],
};
```

```ts
// any global .d.ts — loads type augmentations (forwardProps, etc.)
import 'bare-styled/types';
```

That's the whole migration. Application code keeps importing
`styled-components`; the plugin rewrites what it can prove safe and leaves
everything else on real styled-components, so enabling it never changes
behavior for the parts it doesn't compile.

## How it works

**No wrapper components.** The build points the automatic JSX runtime at
`bare-styled`. When a styled component is used, `jsx()` resolves it on the
spot: styles become a hash class, props are filtered, and React receives the
host element directly. A styled element costs one fiber, exactly like writing
`<button className=…>` by hand. (Classic `React.createElement` is covered by a
patch; elements created by unpatched third-party code still render correctly
through a `forwardRef` fallback.)

**Three compilation tiers, cheapest wins.**

| tier | when | runtime cost |
|---|---|---|
| static | template fully resolvable at build (module constants, `${theme.x}` chains, same-file `${Component}` selectors and static `css` fragments) | zero — finished rule ships in the bundle |
| skeleton | dynamic values only in declaration-value position (`gap: ${p => p.gap};`) | call the fns + string substitution — no CSS parser |
| live | structure can change per render (block-position interpolations) | full resolve, aggressively cached |

In a large production codebase, ~81% of styled components land in the first
two tiers and never run stylis in the browser.

**Fast by default at build time too.** The default transform engine is
oxc-parser + magic-string (~0.8 ms per styled file, ~6× faster than the Babel
engine, which remains available as the reference implementation and automatic
per-file fallback).

## Supported API

`styled.tag`, `styled('tag')`, `styled(Component)`, `styled(Compound.Member)`,
`styled(Comp<T>)`, extension chains `styled(Styled)`, `.attrs(...)`,
`.withConfig({ componentId, displayName, shouldForwardProp })`, `keyframes`
interpolation, `${Component}` selectors, the `as` prop, transient `$props`,
and statics passthrough (`styled(Dropdown)` still exposes `Dropdown.Item`).

### `forwardProps` (bare-styled extension)

One call that shapes all element props — a faster, more direct replacement for
`shouldForwardProp` and for hand-written prop-stripping wrapper components:

```ts
const Stack = styled.div.withConfig({
  forwardProps: ({ gap, align, ...rest }) => rest, // what the DOM receives
})`
  display: flex;
  gap: ${p => p.gap};
  align-items: ${p => p.align};
`;
```

Style interpolations still see the original props, so styling props can drive
CSS while being stripped from the DOM. `children` always pass through;
`className` from the shape merges after the generated classes; it applies once
at the final target, so every template in an extension chain sees full props.

## Safe fallback + diagnostics

Anything the transform can't prove safe — `css` / `keyframes` /
`createGlobalStyle` helpers, unknown `withConfig` options, exotic chain shapes,
function-scope definitions — stays untouched and runs on real
styled-components. The Vite plugin warns whenever a file ends up with mixed
rendering (some templates compiled, some left on styled-components), because
cascade ties between the two sheets are not order-guaranteed.

`BARE_STYLED_DEBUG=1` prints per-file stats during the build (templates
compiled, build-precompiled, bailed). At runtime, `__getFallbackRenders()`
reports how many styled elements paid a wrapper fiber through the `forwardRef`
fallback — 0 in a correctly wired app, and each offender warns once in dev.

## Limitations

`ThemeProvider` / context theming is not supported — a host element cannot
read React context, so `p => p.theme.x` interpolations are dropped (the rest
of the rule still applies). Use module-scope theme constants, or keep specific
components on styled-components.

Parents that introspect their children's elements (`child.props.width`,
`child.type === Column`) see the resolved host element, not the authored
styled component — element resolution happens at creation time. Components
whose elements a parent inspects should stay real components (a small
wrapper).

Vendor prefixing is opt-in (styled-components v6 parity): call
`setVendorPrefixes(true)` from the runtime and pass `vendorPrefixes: true` to
the plugin so build-time and runtime rules match.

## Other build setups

The Babel plugin works anywhere Babel does — pass the imported function, not a
name string (a bare `'bare-styled'` would be normalized to
`babel-plugin-bare-styled`):

```js
import bareStyled from 'bare-styled/transform';
// babel config: plugins: [[bareStyled, { /* options */ }]]
```

The raw fast engine is exposed as `fastTransform(code, { filename })` from
`bare-styled/fast-transform` for custom bundler integrations. Options for the
plugin and both engines: `engine` (`'oxc'` default | `'babel'`), `displayName`
(default `true`), `vendorPrefixes` (default `false`), `topLevelImportPaths`,
`runtimeImportPath`, `namespace`.

## Development

```bash
pnpm install
pnpm build                          # babel src -d lib (both transform engines)
pnpm test                           # jest — runtime + transform + differential suites
node profiling/refresh-report.mjs   # rerun the perf matrix, rebuild docs/perf-report.html
node scripts/bundle-oxc.js          # regenerate vendor/oxc-parser.cjs after oxc bumps
```

MIT licensed.
