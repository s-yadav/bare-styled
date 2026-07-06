// `just-styled/jsx-runtime` — a drop-in replacement for `react/jsx-runtime`
// that resolves compiled descriptors. Point a bundler's automatic JSX runtime
// at `just-styled` (e.g. Vite/oxc `jsxImportSource: 'just-styled'`, Babel
// `importSource`) and every `jsx`/`jsxs` call flows through the wrappers below.
//
// This is the deterministic alternative to `just-styled/runtime/patch`: rather
// than monkeypatching `react/jsx-runtime`'s exports (which some bundlers freeze
// or snapshot, so the patch silently no-ops), the compiled app imports these
// wrapped functions directly. The wrappers delegate to React for everything
// that is not a descriptor, gated by a cheap hot-path check.
'use strict'

const ReactJsxRuntime = require('react/jsx-runtime')
const { wrapJsx } = require('./patch-impl')

exports.Fragment = ReactJsxRuntime.Fragment
exports.jsx = wrapJsx(ReactJsxRuntime.jsx)
exports.jsxs = wrapJsx(ReactJsxRuntime.jsxs)
