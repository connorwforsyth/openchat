import { textKind } from "./text";

/**
 * What a React artifact may import. The runtime bundles these, so previews
 * need no network (D24).
 */
export const REACT_IMPORTS = ["react", "react-dom"] as const;

/**
 * One TSX file with a default-exported component, compiled and mounted by
 * the runtime. Imports outside `REACT_IMPORTS` fail when it renders; saving
 * doesn't check them yet, as it didn't before the kit.
 */
export const reactKind = textKind({
  // The runtime stamps each element's source line (`data-src`, D16).
  annotate: true,
  export: [{ extension: "tsx", format: "file" }],
  icon: "LayersIcon",
  kind: "react",
  label: "React component",
  render: { imports: REACT_IMPORTS, panel: "source", runtime: "react" },
  shape: /export\s+default\b/,
  starter: {},
  thumbnail: "runtime",
});
