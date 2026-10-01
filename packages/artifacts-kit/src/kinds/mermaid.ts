import { textKind } from "./text";

/** Diagram source, drawn by Mermaid in the runtime. */
export const mermaidKind = textKind({
  export: [{ extension: "mmd", format: "file" }],
  icon: "NetworkIcon",
  kind: "mermaid",
  label: "Diagram",
  render: { panel: "source", runtime: "mermaid" },
  shape:
    /^\s*(graph|flowchart|sequenceDiagram|classDiagram|stateDiagram|erDiagram|gantt|pie|mindmap|timeline)\b/,
});
