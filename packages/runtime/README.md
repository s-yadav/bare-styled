# just-styled

The runtime half of [just-styled](../../README.md), a compile-time fork of `babel-plugin-styled-components`. The babel plugin precompiles eligible `styled.tag` components into static CSS rules plus CSS variables, and emits a tiny descriptor instead of a styled-components wrapper. This package renders those descriptors.

You don't use this package directly. The plugin imports it into your compiled output:

- `just-styled/runtime` exports `createStyledElement`, which builds a descriptor and registers its precompiled CSS into a shared style sheet (a single `<style data-just-styled>` tag in the browser, an in-memory collection on the server).
- `just-styled/runtime/patch` installs a `React.createElement` patch (and the automatic JSX runtime equivalents) that recognizes descriptors and renders them as plain native elements with a static class and inline CSS variables.

When a render needs styled-components' full machinery, such as an `as` or `theme` prop, the patch falls back to a real styled-components component built lazily from the original template. Everything else skips the styled-components runtime entirely.

For server rendering, `renderStaticStyles()` returns the collected CSS as a `<style>` tag string to embed in your HTML.

`react >=16.8` is a peer dependency. `styled-components` is an optional peer: it is only pulled in by your compiled code when a fallback is actually constructed.

## A single React copy is required

The patch monkey-patches `React.createElement` / the JSX runtimes, and the fallback creates elements with `React`. Both must be the *same* React instance the host app renders with. This is automatic for a normal `npm install` (React resolves to the consumer's copy, since this package bundles none). But when you consume the runtime via a **linked dev checkout** (`link:`/`file:` to a clone that has its own `react` in `node_modules`), the runtime can resolve that checkout's React instead — a second, version-mismatched copy. React then throws:

> Objects are not valid as a React child (found: object with keys {$$typeof, type, key, props, ...})

Force a single copy in the consumer's bundler. For Vite: `resolve.dedupe: ['react', 'react-dom']` (and clear the pre-bundle cache: `rm -rf node_modules/.vite`). For webpack/rspack: a `resolve.alias` pointing `react`/`react-dom` at the app's copy.
