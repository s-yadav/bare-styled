// Type augmentation for bare-styled's `withConfig` extensions on top of
// styled-components' own types (the authoring surface — apps import `styled`
// from 'styled-components' and the build rewrites it, so TypeScript checks
// `.withConfig({...})` against styled-components' StyledOptions interface).
//
// Load it once from any global .d.ts in the app:
//
//   import 'bare-styled/types';
//
// Interface merging requires the type parameter list to match styled-components
// v6's declaration exactly: `StyledOptions<R extends Runtime, Props extends object>`.
// NOTE the augmented module path: TypeScript merges interface augmentations only
// at the module where the interface is DECLARED — for styled-components v6 that
// is 'styled-components/dist/types' (the root package merely re-exports it).
import 'styled-components'

declare module 'styled-components/dist/types' {
  export interface StyledOptions<R extends Runtime, Props extends object> {
    /**
     * bare-styled extension (no styled-components equivalent): ONE call that
     * receives all incoming props and returns the exact props for the final
     * element — a single destructure instead of a `shouldForwardProp` check
     * per prop, and a drop-in replacement for hand-written Layout wrapper
     * components (which each cost a wrapper fiber).
     *
     *   styled.div.withConfig({
     *     forwardProps: ({ gap, align, ...rest }) => rest,
     *   })`display:flex; gap:${p => p.gap}px;`
     *
     * Semantics: style interpolations still see the ORIGINAL props (transient
     * props can drive CSS while being stripped from the DOM); the returned
     * object fully replaces the default prop filter and takes precedence over
     * `shouldForwardProp`; `className` in the shape merges after the generated
     * classes; `children` always pass through from the original element (a
     * children key in the shape is ignored); applies once at the final target,
     * so every template in a styled(styled(X)) chain sees the full props.
     */
    forwardProps?: ((props: Props & { [key: string]: any }) => object) | undefined
  }
}
