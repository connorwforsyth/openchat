import { textKind } from "./text";

/**
 * A file in any language, shown as source. Its version's `language` picks
 * the extension when it's exported; `txt` is the fallback.
 */
export const codeKind = textKind({
  export: [{ extension: "txt", format: "file" }],
  icon: "CodeIcon",
  kind: "code",
  label: "Code",
  render: { panel: "source", runtime: null },
  shape: /\S/,
});
