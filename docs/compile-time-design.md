# bare-styled: design

**Goal:** styled-components' exact styling model — resolve a template against
props, hash the result, inject a rule, use the class — but rendered so the
styled component collapses to a plain host element instead of a wrapper
component. The win is **fewer React fibers/hooks**, at parity on CSS cost.

`styled` usage does not change; it's a drop-in for the supported surface.

## Two pieces

**Plugin** (`src/js-transform.js`, a small Babel transform — no longer a fork of
babel-plugin-styled-components). It rewrites only the simple styled forms —
`styled.tag`, `styled('tag')`, `styled(Ident)` — into

```js
createStyled(component, { componentId, displayName })`…template…`
```

keeping the template's interpolations **live**. It generates a stable
`componentId` (`sc-<file-hash>-<n>`) and `displayName`, and injects the runtime
import. `.attrs` / `.withConfig` chains and the `css` / `keyframes` /
`createGlobalStyle` helpers are left untouched (they run through real
styled-components). A **zero-interpolation** template is stylis-compiled at
build time and emitted as `css: "<rule>"` in the config (see Opt 2).

**Runtime** (`packages/runtime`, package `bare-styled`):

- `createStyled` returns a `forwardRef` descriptor carrying the cached template
  `parts`, `componentId`, and `styledComponentId === componentId` (so it can be
  a `${Comp}` selector target and a `styled(Descriptor)` target). It is a valid
  element type, so it renders correctly even with no patch installed.
- The **JSX runtime wrappers** (`bare-styled/jsx-runtime`,
  `bare-styled/jsx-dev-runtime`) and the `createElement` patch intercept a
  descriptor at element-creation time and resolve it to a host element — so no
  wrapper fiber is added to the tree.

## Style resolution (the engine, `packages/runtime/src/engine.js`)

styled-components' own `css()` does the static half of the flatten once at
definition time: it bakes module values, `css` fragments, style objects and
`${StyledComponent}` selectors into strings, leaving only prop-dependent
**functions**. From there:

- **Static** (no functions survive) → resolve once, register a single rule
  under the `componentId`, and use `componentId` as the class. No per-render
  work, no hash. (Opt 1)
- **Zero-interpolation static** → the plugin already compiled the rule at build
  time; the runtime just registers it (no `css()`/stylis at runtime). (Opt 2)
- **Dynamic** (a prop function survives) → per render, resolve the functions
  against props into a CSS string, look it up in a string-keyed cache, and only
  on a miss run MurmurHash + stylis + inject a `js-<hash>` rule. `componentId`
  rides along as a marker (for `${Comp}` selectors); the hash class carries the
  styles. This mirrors styled-components' dynamic-name cache, so re-renders of
  unchanged styles are a `Map.get`, not a hash.

## Resolution (`resolveDescriptor` in patch-impl.js)

For a descriptor + props:

- `className = componentId` (static) or `componentId + ' ' + js-<hash>`
  (dynamic), plus any user `className`.
- `as` prop selects the rendered tag.
- Native tag → filter non-DOM props (`@emotion/is-prop-valid` + always-kept:
  `className`/`style`/`children`/`ref`/`on*`/`data-`/`aria-`).
- Component target → forward all props (minus `as`) plus the `className`, which
  the component spreads onto its host node (no token trick).
- A descriptor whose target is itself a descriptor unwraps in a loop.

**No bail-out.** Every styled render is a host element (or a forward to a
component); there is no fallback to a styled-components wrapper.

## Stylesheet (`sheet.js`)

Browser: rules go through the CSSOM `insertRule` API (incremental, no
re-parse), with a depth-0 splitter so a compiled string containing `&:hover` /
`@media` is inserted as separate rules; a per-rule `try/catch` falls back to a
text node. An in-memory `Map` is the source of truth for `getCss()` / SSR.

## The discriminator

A genuine descriptor self-references under the shared global symbol
(`element[Symbol.for('bare-styled')] === element`). A real styled component that
hoists the symbol points at the original descriptor, so the identity check
excludes it — this survives descriptors carrying a `styledComponentId`.

## Known limitations

- **`ThemeProvider` / context theme is not supported.** A host element can't
  read React context, so `props.theme` is undefined; `p => p.theme.x` is
  swallowed (that interpolation drops, the rest of the rule applies). Use a
  module-scope theme constant, or a CSS-variable theme. Reading context would
  require a per-component fiber, defeating the point.
- **`keyframes` interpolations ARE supported**: the engine duck-types the
  Keyframes object ({ name, rules, getName } — stable across SC v5/v6 and
  across duplicate styled-components copies), injects `@keyframes <name>` into
  the bare-styled sheet once (deduped by name, re-injected after a sheet
  reset), and resolves the interpolation to the animation name.
- **`styled(styledComponent)`** cascade is handled by the sheet's group
  ordering (definition-order groups): base rules always precede extender rules,
  so the extender wins equal-specificity conflicts regardless of render order.
- Per-subtree `StyleSheetManager` config (custom stylis plugins, target sheet,
  nonce) is not honored on the flattened path.

## Testing

`test/js-transform.test.js` (plugin emit), `test/runtime/*` (engine, resolution,
sheet), `test/e2e/*` (compile → render in jsdom), `test/perf/*` +
`profiling/*` (perf harnesses).
