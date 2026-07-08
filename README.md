# `babel-plugin-styled-components`

This plugin is a highly recommended supplement to the base styled-components library, offering some useful features:

- consistently hashed component classNames between environments (a must for server-side rendering)
- better debugging through automatic annotation of your styled components based on their context in the file system, etc.
- various types of minification for styles and the tagged template literals styled-components uses

## Requirements

This plugin is tested against:

- `@babel/core` `^7`
- `styled-components` `>= 6` (earlier majors may still work but aren't exercised in CI)

## Quick start

Install the plugin first:

```
npm install --save-dev babel-plugin-styled-components
```

Then add it to your babel configuration:

```JSON
{
  "plugins": ["babel-plugin-styled-components"]
}
```

## Options

Full option reference lives on the [styled-components documentation site](https://www.styled-components.com/docs/tooling#babel-plugin). A couple worth flagging here:

- `topLevelImportPaths` (`string[]`): additional module specifiers whose `styled` export should be recognized alongside `styled-components`. Useful for libraries that re-export the styled-components API.
- `cssPropImportPath` (`string`, default `'styled-components'`): which package the css-prop transform should auto-import `styled` from when the file doesn't already have a styled import. Set to `'styled-components/native'` for React Native targets.

## just-styled

just-styled keeps styled-components' styling model but renders each `styled`
component as a **plain host element** rather than a wrapper component — removing
a React fiber (and its hooks) per styled element while matching styled-components
on CSS cost.

The plugin rewrites `styled.tag\`…\`` / `styled('tag')\`…\`` / `styled(Ident)\`…\``
into `createStyled(component, { componentId, displayName })\`…\`` (interpolations
stay live) and imports the `just-styled` runtime. Point your bundler's automatic
JSX runtime at just-styled (`jsxImportSource: 'just-styled'`) so descriptors
resolve to host elements. At render, prop interpolations resolve against props,
hash to a class, and inject a rule (deduped); components with no prop-dependent
styles resolve once to a `componentId` class, and zero-interpolation templates
are compiled at build time. There is **no bail-out** — every styled render is a
host element.

`.attrs` / `.withConfig` chains and the `css` / `keyframes` / `createGlobalStyle`
helpers are left untouched and run through real styled-components.

**Known limitation:** `ThemeProvider` / context theme is not supported (a host
element can't read React context; `props.theme` is undefined). Use a module-scope
theme constant. Design notes and other limitations: `docs/compile-time-design.md`;
runtime details: `packages/runtime/README.md`.

## Changelog

See [Github Releases](https://github.com/styled-components/babel-plugin-styled-components/releases)

## Documentation

**The documentation for this plugin lives on [the styled-components website](https://www.styled-components.com/docs/tooling#babel-plugin)!**

- [Usage](https://www.styled-components.com/docs/tooling#usage)
- [Better debugging](https://www.styled-components.com/docs/tooling#better-debugging)
- [Minification](https://www.styled-components.com/docs/tooling#minification)

## License

Licensed under the MIT License, Copyright © 2016-present Vladimir Danchenkov and Maximilian Stoiber.

See [LICENSE.md](./LICENSE.md) for more information.
