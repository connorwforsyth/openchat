import { textKind } from "./text";

/** One `<svg>` element. */
export const svgKind = textKind({
  export: [{ extension: "svg", format: "file" }],
  icon: "PenToolIcon",
  kind: "svg",
  label: "SVG image",
  render: { panel: "frame", runtime: "svg" },
  shape: /^\s*<svg[\s>][\s\S]*<\/svg>\s*$/,
  starter: {},
  thumbnail: "runtime",
});
