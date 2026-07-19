// Hand-maintained types for `just-styled/vite` (lib/ is plain JS built by
// Babel; keep this in sync with src/vite-plugin.js).

export interface JustStyledOptions {
  /**
   * Transform engine. 'oxc' (default) parses with oxc-parser (Rust) and edits
   * with magic-string — ~8.5x faster than Babel with differential-tested
   * equivalent output. Any file the fast engine cannot handle (parse error,
   * exotic pattern) automatically falls back to the Babel engine; 'babel'
   * forces the reference implementation everywhere (requires @babel/core,
   * an optional peer dependency).
   */
  engine?: 'oxc' | 'babel';
  /** Attach `displayName` to descriptors (React DevTools). Default true. */
  displayName?: boolean;
  /**
   * Vendor-prefix build-precompiled rules. Default false, matching both the
   * just-styled runtime default and styled-components v6. If enabled, also
   * call `setVendorPrefixes(true)` from `just-styled/runtime` at app startup
   * so runtime-compiled rules match.
   */
  vendorPrefixes?: boolean;
  /** Extra module specifiers whose `styled` export should be recognized. */
  topLevelImportPaths?: string[];
  /** Where the injected `createStyled` / patch imports point. */
  runtimeImportPath?: string;
  /** Prefix for generated componentIds (multi-app disambiguation). */
  namespace?: string;
}

/**
 * The just-styled Vite plugin: an `enforce: 'pre'` transform that rewrites
 * styled-components tagged templates into just-styled descriptors before the
 * JSX/TS compiler runs. Pair with `react({ jsxImportSource: 'just-styled' })`.
 *
 * Typed structurally (name/enforce/transform) rather than as Vite's `Plugin`
 * so this package does not need a vite dependency; the object is assignable
 * to `Plugin` wherever vite's types are in scope.
 */
export function justStyled(options?: JustStyledOptions): {
  name: string;
  enforce: 'pre';
  transform(
    code: string,
    id: string
  ): Promise<{ code: string; map: object | null } | null>;
};

export default justStyled;
