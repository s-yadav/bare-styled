// `just-styled/jsx-dev-runtime` — dev-mode counterpart of `./jsx-runtime`.
// See that file for why this exists (deterministic descriptor resolution
// through the automatic JSX runtime instead of monkeypatching).
'use strict'

const ReactJsxDevRuntime = require('react/jsx-dev-runtime')
const { wrapJsx } = require('./patch-impl')

exports.Fragment = ReactJsxDevRuntime.Fragment
exports.jsxDEV = wrapJsx(ReactJsxDevRuntime.jsxDEV)
