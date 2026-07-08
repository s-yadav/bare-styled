# just-styled

The runtime half of [just-styled](../../README.md). just-styled renders a
`styled` component as a plain host element instead of a wrapper component — so
you keep styled-components' styling model but drop a React fiber (and its hooks)
per styled element.

You don't use this package directly. The plugin rewrites `styled.tag\`…\`` into
`createStyled(component, { componentId, displayName })\`…\`` (keeping the
template's interpolations live), and imports this runtime:

- `just-styled/runtime` exports `createStyled`, which returns a lightweight
  descriptor holding the flattened template.
- `just-styled/jsx-runtime` + `just-styled/jsx-dev-runtime` are wrapped automatic
  JSX runtimes (select via `jsxImportSource: 'just-styled'`). `just-styled/runtime/patch`
  monkey-patches `React.createElement` / the JSX runtimes as an alternative.
  Either way, a descriptor is resolved to a host element at element-creation
  time — no wrapper fiber.

Styles use styled-components' model: at render, the template's prop functions
are resolved against props into a CSS string, hashed to a `js-<hash>` class, and
injected once (deduped by resolved string). Components whose styles don't depend
on props resolve once to a single rule under their `componentId` — no per-render
hashing — and templates with no interpolations at all are compiled at build
time. In the browser, rules are inserted via the CSSOM `insertRule` API; an
in-memory sheet backs `getCss()` / `renderStaticStyles()` for SSR.

`react >=16.8` is a peer dependency; `styled-components >=6` is used for its
`css()` flatten.

## Known limitations

- **`ThemeProvider` / context theme is not supported.** A host element can't
  read React context, so `props.theme` is `undefined`; a `p => p.theme.x`
  interpolation is swallowed (it drops out; the rest of the rule still applies).
  Use a module-scope theme constant or a CSS-variable theme instead.
- `keyframes` interpolated into a template isn't injected yet.
- `styled(anotherStyledComponent)` can lose an equal-specificity cascade tie to
  the wrapped component (the outer rule is inserted first).

## A single React copy is required

The patch monkey-patches `React.createElement` / the JSX runtimes, and the
runtime creates elements with `React`. Both must be the *same* React instance
the host app renders with. This is automatic for a normal `npm install`. But
when you consume the runtime via a **linked dev checkout** (`link:`/`file:` to a
clone that has its own `react` in `node_modules`), the runtime can resolve that
checkout's React — a second, version-mismatched copy — and React throws:

> Objects are not valid as a React child (found: object with keys {$$typeof, type, key, props, ...})

Force a single copy in the consumer's bundler. For Vite:
`resolve.dedupe: ['react', 'react-dom']` (and clear the pre-bundle cache:
`rm -rf node_modules/.vite`). For webpack/rspack: a `resolve.alias` pointing
`react`/`react-dom` at the app's copy.
