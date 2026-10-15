import { textKind } from "./text";

/** One complete HTML document, shown in a sandboxed frame. */
export const htmlKind = textKind({
  export: [{ extension: "html", format: "file" }],
  icon: "GlobeIcon",
  kind: "html",
  label: "Web page",
  render: { panel: "frame", runtime: "html" },
  shape: /<[a-z!][\s\S]*>/i,
  starter: {},
  thumbnail: "runtime",
});
