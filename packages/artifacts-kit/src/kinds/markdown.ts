import { textKind } from "./text";

/** A Markdown document, rendered by the panel itself. */
export const markdownKind = textKind({
  export: [{ extension: "md", format: "file" }],
  icon: "FileTextIcon",
  kind: "markdown",
  label: "Document",
  render: { panel: "markdown", runtime: null },
  shape: /\S/,
});
