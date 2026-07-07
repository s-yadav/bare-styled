// just-styled plugin entry.
//
// Decoupled from babel-plugin-styled-components: the transform now only rewrites
// `styled` tagged templates into `createStyled(...)` calls (keeping the template
// live), and the runtime resolves the CSS on first render. All the old
// compile-time CSS machinery (minify, static extraction, stylis, css-prop,
// template-literal transpilation, withConfig annotation) has been removed.
export { default } from './js-transform'
