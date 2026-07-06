# just-styled: compile-time styled-components

Goal: move styled-components work from runtime to compile time. The babel plugin (fork of babel-plugin-styled-components) precompiles CSS into static class rules + CSS variables, and emits a lightweight descriptor object instead of relying on the styled-components runtime wrapper. A runtime package (`packages/runtime`, published as `just-styled`) handles rendering descriptors. Drop-in: app code using `styled` does not change.

## Plugin option

- `compileStatic` (boolean, default `false`): enables the new stage.
- `runtimeImportPath` (string, default `'just-styled/runtime'`): module the emitted helper is imported from.

All existing options/behavior of babel-plugin-styled-components are preserved. When `compileStatic` is off, output is byte-identical to upstream.

## Pipeline placement

In `processTaggedTemplate` (src/visitors/process.js) the new stage `compileStatic` runs after `minify` and `displayNameAndId` (so it sees minified CSS and can read displayName/componentId from the `.withConfig({...})` object), and before `templateLiterals`. When it replaces the node, the original tagged template survives inside the `fallback` arrow and is still processed by the remaining visitors on requeue (withConfig merge is idempotent; templateLiterals transpiles the inner template as usual).

## Eligibility (MVP)

A `styled.tag`...`` component compiles to a descriptor iff:

- Tag form is `styled.htmltag`, `styled('htmltag')` (native element, known string), or `styled(Component)` where `Component` is a plain identifier in scope. Member expressions (`styled(obj.Component)`), call results (`styled(hoc())`), and every other tag shape → bail out.
- No `.attrs(...)` in the chain. `.withConfig` is fine.
- Every interpolation is classified as static or var-compatible (below).
- Helpers (`css`, `keyframes`, `createGlobalStyle`) are never compiled — untouched.

For `styled(Component)` the descriptor's `component` is the identifier itself rather than a tag string, and the runtime resolves css variables via the sc-inline mechanism: the patch registers `getInlineStyles(props)` under a fresh id, forwards `className = desc.className + ' sc-inline-<id>'` (plus any user className) to the component along with all props, and when the forwarded className later reaches a native element the patch consumes the registry entries (delete on read), strips the tokens, and merges the vars into that element's `style`. Vars therefore land on the last native element even through nested wrappers, and descriptors wrapping other descriptors unwrap one layer per resolution pass.

Bail-out = emit exactly what the plugin emits today. No descriptor, no runtime import. This is the universal safety valve.

## Interpolation classification

Interpolations arrive as `__PLACEHOLDER_<i>__` tokens (src/css/placeholderUtils.js) in minified CSS with expressions in `quasi.expressions`.

1. **Static**: `exprPath.evaluate()` is confident and yields string/number → inline the value into the CSS text at compile time.
2. **Var-compatible (dynamic)**: Arrow/function expression whose body only reads its props param (including destructuring), does NOT reference `.theme`, and whose placeholder sits in a declaration *value* position (heuristic on minified css: placeholder appears after a `:` that comes after the last `{` or `;`). → replace token with `var(--<componentId>-<i>)` and record `['--<componentId>-<i>', <original fn>]`.
3. **Anything else** (theme access, identifiers referencing other components/keyframes/css results, spread mixins, selector/property/block positions, member calls) → bail out entirely.

The var-compatible check enforces "reads only its own bindings" via a `ReferencedIdentifier` traversal that bails on any identifier without a binding inside the function. TypeScript type-position identifiers are exempt: with syntax-only TS parsing (no TS transform, as in a Vite/oxc build) the `Props` in `(p: Props) => …`, `Array<Props>`, `x as Props`, etc. is visited as a referenced identifier but has no value binding, so identifiers under a `TSType` node (`t.isTSType`) are skipped. This is why typed interpolations and generic tags (`styled.div<Props>`, whose type args sit on the tagged-template node, not the tag) compile. See `test/fixtures/compile-static-ts-type-annotations`.

## CSS compilation

After substitution, wrap in `.<staticClassName>{<css>}` and compile at build time with `stylis@4` (same as styled-components v6): `serialize(compile(input), middleware([prefixer, stringify]))`. `staticClassName = 'js-' + hash(componentId + css)` using src/utils/hash.js. Result is a static rule string embedded in the output.

## Emitted output

```js
import styled from 'styled-components'
import { createStyledElement as _jsCreate } from 'just-styled/runtime'

const Button = /*#__PURE__*/ _jsCreate({
  component: 'button',
  className: 'js-1a2b3c',
  css: '.js-1a2b3c{color:var(--sc-abc-0-0);font-size:14px;}',
  vars: [['--sc-abc-0-0', props => props.color]],
  displayName: 'Button',       // only when displayName option is on
  componentId: 'sc-abc-0',
  fallback: () => styled.button.withConfig({ displayName: 'Button', componentId: 'sc-abc-0' })`color:${props => props.color};font-size:14px;`,
})
```

`vars` fns are the original interpolation expressions, moved verbatim.

## Runtime (`packages/runtime`, package name `just-styled`)

Exports from `just-styled/runtime`:

- `IS_STYLED = Symbol.for('just-styled')`
- `createStyledElement(desc)` → descriptor: a `React.forwardRef` object carrying the styled-components component contract. `React.forwardRef` gives `$$typeof === Symbol.for('react.forward_ref')`; adding `styledComponentId` (= the static `className`) makes styled-components' `isStyledComponent` true, so the descriptor is a **first-class styled component**: it can be interpolated as a component selector (`${Descriptor} { … }` → `.<className>`, the same class it renders with) and be a `styled(Descriptor)` target. A bare function does not work — `flatten` tests `isFunction` before the styled-component branch and would *invoke* it; a plain object is read as a CSS style object; only a genuine styled component resolves to its selector, and does so consistently across styled-components 6.x. `target`, `attrs`, `foldedComponentIds`, and a no-op `componentStyle` shim are the minimal contract `styled(Descriptor)` folding reads (the descriptor's css already lives in the just-styled sheet, so it contributes no extra rules). With the patch/jsx wrapper installed, resolution intercepts on `IS_STYLED` before React renders the forwardRef, so the descriptor collapses to its host element with **no extra fiber**; the render body runs only in the `as`/`theme` fallback (where a real styled component's fiber is needed anyway) or with neither wrapper nor patch present. The discriminator is a **self-reference** — `element[IS_STYLED] = element`, so a genuine descriptor satisfies `type[IS_STYLED] === type`; a real styled component wrapping a descriptor hoists that value by reference, so its `IS_STYLED` points at the original descriptor and the identity check fails, correctly excluding it (this replaces the old `styledComponentId === undefined` check, unusable now that descriptors carry a `styledComponentId`). Fields:
  - `[IS_STYLED]: element` (self-reference), `component`, `className`, `styledComponentId`, `displayName` (when the option emitted one)
  - `getStyle()` → the precompiled css string
  - `getInlineStyles(props)` → `{ [varName]: value }` from `vars`, skipping null/undefined/false results
  - `getStyledComponent()` → memoized `desc.fallback()`
  - `toString()` → `'.' + className` (so `${Button}` in other css keeps working)
  - Side effect at creation: css registered into a singleton sheet — browser: one `<style data-just-styled>` tag appended with rule text (dedup by className); SSR/no-DOM: collected in memory, exposed via `renderStaticStyles()` / `getStyleTag()`.
- `installCreateElementPatch()` — idempotent monkey patch of `React.createElement` (and `jsx`/`jsxs` of `react/jsx-runtime` + `react/jsx-dev-runtime` when patchable):
  - type is a descriptor — detected as `IS_STYLED` present *and* `styledComponentId` absent: real styled-components components that wrap a descriptor inherit `IS_STYLED` via hoist-non-react-statics (it copies the target's own symbols), and those wrappers must render through styled-components untouched or their own css is silently dropped:
    - props contain `as` or `theme` → render `type.getStyledComponent()` instead (full fidelity).
    - `component` is a string tag → merge `className = desc.className + ' ' + props.className`, `style = { ...getInlineStyles(props), ...props.style }`, drop non-DOM props (via `@emotion/is-prop-valid`), call original createElement with the tag.
    - `component` is a component ref → **sc-inline hack**: allocate `id`, register `getInlineStyles(props)` in a registry, pass `className = desc.className + ' sc-inline-' + id` down (descriptors without vars skip the registry and forward the plain className); when the patch later sees a *native* (string-typed) element whose className contains `sc-inline-<id>`, it consumes the registry entry (delete on read), strips the token, and merges the styles into that element's `style`. Registry is a Map with a size cap as a leak guard. Resolution loops, so a component ref that is itself a descriptor unwraps until a plain type remains.
  - anything else → original createElement untouched.
- `just-styled/runtime/patch` — side-effect module that calls `installCreateElementPatch()` on load. The babel plugin injects this import into any file where it emits a descriptor.

## Testing

- Fixture tests (babel-test) under `test/fixtures/compile-static-*` with `compileStatic: true` in `.babelrc`: fully static, static+vars, styled(Component) with and without vars, bail-outs (attrs, theme, styled(obj.Component), selector-position interpolation), interplay with `transpileTemplateLiterals` and `minify: false`.
- Runtime unit tests (jest + react-dom/server via moduleNameMapper to packages/runtime/src): descriptor shape, sheet injection/SSR collection, patch rendering static className + css vars, `as`/fallback path, sc-inline forwarding through a wrapper component and registry delete-on-read hygiene, toString interpolation, real styled-components wrapping a descriptor, rendering without the patch installed.
- E2E smoke: babel-transform a sample file with the real plugin, evaluate it, render with react-dom/server, assert markup. Covers descriptors wrapping other compiled descriptors (single-element output, both static classes, source-order css) and bailed-out styled calls wrapping a descriptor at module level.

## Known MVP limitations (documented, acceptable)

- Theme-dependent interpolations always take the fallback styled-components path.
- sc-inline registry assumes the wrapper renders its native node in the same synchronous render pass; concurrent-mode edge cases fall back to no inline styles rather than wrong styles. Wrappers that drop the forwarded className lose both the static class and the vars (same failure mode as styled-components itself).
- `.attrs`, non-identifier component refs, keyframes/css/createGlobalStyle: untouched (future work).
- Optimization hints from users: future work, discussed separately.
