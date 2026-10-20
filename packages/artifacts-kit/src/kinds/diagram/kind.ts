import { defineArtifactKind } from "../../define";
import { DIAGRAM_CHECKS } from "./checks";
import { diagramFromModel, diagramToModel } from "./model-text";
import { DIAGRAM_EDITS } from "./operations";
import { type Diagram, diagramContentSchema, serializeDiagram } from "./schema";

// The Diagram kind (165): a flowchart the model writes as data (nodes and
// edges, no coordinates) and a trusted editor in the app draws, lays out
// and lets a person rearrange. No model code runs, so it needs no sandbox
// or runtime. The `mermaid` kind stays for sequence and other diagrams.

/** What the model is told about diagrams, after the artifacts fragment. */
export const DIAGRAM_INSTRUCTIONS = `Diagrams (create_artifact type "diagram") are flowcharts and other node-and-arrow graphs the user can rearrange, relabel and extend in the app, and export as SVG, PNG or Mermaid. Prefer them to "mermaid" for flowcharts, processes, architectures and org charts; use "mermaid" for sequence, class, state, Gantt and other diagram types.

Write a diagram's content as JSON, with no coordinates (the app lays it out):
{"direction":"TB","nodes":[{"id":"start","label":"Start","shape":"stadium"},{"id":"ok","label":"Approved?","shape":"diamond"}],"edges":[{"from":"start","to":"ok","label":"submit"}]}
- direction: TB (top to bottom), LR, BT or RL.
- nodes: id (letters, digits, _ and -; unique), label, shape (rect, the default; rounded, stadium, diamond for decisions, circle), and an optional group (nodes sharing one are boxed together).
- edges: from and to (node ids) and an optional label.
At most 200 nodes and 400 edges.

To change part of a diagram, call update_artifact with \`edit\` instead of \`content\`:
- add_nodes: nodes, and edges that connect them.
- connect: edges between existing nodes.
- update_node: id, and a new label, shape or group.
- remove: ids (nodes, with their edges) and edges ({from, to}).
- replace: the whole graph as JSON in content. Prefer it to sending content, which drops the layout the user arranged.
The user may have moved or edited nodes since you wrote it: edit the latest version you were shown.`;

export const diagramKind = defineArtifactKind<Diagram>({
  capabilities: {
    aiCalls: false,
    annotate: false,
    present: false,
    share: false,
  },
  checks: DIAGRAM_CHECKS,
  content: diagramContentSchema,
  diff: "text",
  editor: "canvas",
  export: [
    { extension: "svg", format: "file" },
    { extension: "png", format: "file" },
    { extension: "mmd", format: "file" },
  ],
  icon: "NetworkIcon",
  instructions: DIAGRAM_INSTRUCTIONS,
  kind: "diagram",
  label: "Diagram",
  modelText: {
    fromModel: diagramFromModel,
    serialize: serializeDiagram,
    toModel: diagramToModel,
  },
  operations: DIAGRAM_EDITS,
  render: { panel: "diagram", runtime: null },
  starter: {},
  thumbnail: "runtime",
});
