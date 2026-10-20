---
id: "165"
title: "Diagrams and flowcharts: a `diagram` kind people can edit, on React Flow"
labels: [wayfinder:build]
status: closed
assignee: loop
blockedBy: ["162"]
---

## Question

Connor (2026-10-16): "maybe a flowchart or diagram tool." The `mermaid` kind renders but can't be edited. A diagram is a data kind: the model writes the graph, and a trusted editor in the app draws it. No model code runs, so it needs no sandbox. Dependencies are MIT only while the licence is undecided (PLAN.md Q12), which rules out elkjs.

## Done when

- **Content (JSON):** `{ direction, nodes: [{ id, label, shape, group? }], edges: [{ from, to, label? }], positions? }`.
  - The model writes the graph with no coordinates.
  - Operations: `add_nodes`, `connect`, `update_node`, `remove` and `replace`.
  - Checks: unique ids, no dangling edges, and size caps.
  - `modelText` shows the graph compactly.
- **Layout and editor:**
  - Layout with `@dagrejs/dagre` (MIT), as a pure function in the kit.
  - The viewer and editor live in `packages/chat-ui` and use `@xyflow/react` (React Flow, MIT): drag, relabel, connect and delete.
  - Dragged positions save into `positions`, and a person's edit saves a version through the same checks.
  - Theme tokens only.
- **Export:** `.svg` and `.png` (`html-to-image`, MIT), and Mermaid flowchart text. The `mermaid` kind stays for sequence and other diagram types.
- **Artifacts page:** a "Diagram" starter card, with the rendered graph as its thumbnail.
- **Tests:** kit tests (operations, checks, layout determinism), browser-mode editor tests, and e2e covering create, a drag that saves a version, and export.

## Owns

`packages/artifacts-kit/src/kinds/diagram/**`, `builtin.ts` and `instance.ts` (registration), `packages/chat-ui/src/artifacts/diagram/**`, `e2e/tests/diagrams.spec.ts`.

## Results (2026-10-16)

- **Kit** (`packages/artifacts-kit/src/kinds/diagram/`):
  - `schema.ts` is the zod schema: direction is TB, LR, BT or RL. Nodes are `{id, label, shape, group?}`, with shapes rect, rounded, stadium, diamond and circle. Edges are `{from, to, label?}`, and `positions` is optional.
  - `checks.ts` requires at least one node, unique ids and no dangling edges, and caps a diagram at 200 nodes, 400 edges and 200k characters.
  - `operations.ts` has `add_nodes`, `connect`, `update_node`, `remove` and `replace`. `replace` keeps the positions of nodes whose ids survive.
  - `model-text.ts`: the model writes JSON, which is read strictly and then leniently. It reads back compact JSON, one line per node and edge, without positions or default shapes.
  - `layout.ts` uses dagre as a pure, deterministic function. It estimates node sizes from their labels, keeps dragged positions and draws group boxes.
  - `mermaid.ts` writes flowchart text, with groups as subgraphs and labels escaped.
  - `kind.ts` is registered in `builtin.ts` in place of 162's placeholder. Presentation and spreadsheet stay planned.
  - `define.ts` gains `editor: "canvas"` and `render.panel: "diagram"`.
- **Model**:
  - `diagram` is removed from the directive exclusion in `format.ts`, so `create_artifact` offers it.
  - `update_artifact`'s flat `edit` gains `nodes`, `edges`, `id`, `label`, `shape`, `group` and `ids`. Its operation enum is now the document edits and the diagram edits together.
  - The kind's instructions go in as `kinds/diagram`, loaded on demand by `load_artifact_guide` (160).
  - The artifact and sandbox tool golden snapshots are updated.
- **Editor** (`packages/chat-ui/src/artifacts/diagram/`), on a React Flow canvas:
  - A person can drag a node (its position saves on drop), rename one (double click, or Enter or F2), connect two nodes by their handles, delete with Delete or Backspace, and add a node.
  - Every edit saves a version through `artifacts.saveVersion` with `useDocumentSave`, the same debounce and conflict handling documents use. So a person's edit passes the server's kind checks, with no contract change.
  - Older versions open read only, with Restore. Viewers see the diagram read only.
  - React Flow's `base.css` is themed only through its `--xy-*` variables, which are set to the theme's token `var()`s.
  - Export: SVG and PNG through `html-to-image`, loaded on demand, and Mermaid as `.mmd`.
- **Starter card**: the diagram kind takes the starter card, labelled "Diagram". Mermaid loses its card and is relabelled "Mermaid diagram".
- **Tests**:
  - Kit tests cover the operations, checks, model text, layout determinism and the Mermaid output.
  - chat-ui has tests for its pure model, plus browser-mode tests of the view. They cover drawing the graph, a rename that saves, adding a node, deleting from the keyboard, read only for viewers, restoring an old version, and the export menu.
  - `e2e/tests/diagrams.spec.ts` covers creating a diagram, the model's add_nodes edit, a drag that saves a version with `positions`, and the Mermaid and SVG downloads. It hasn't been run locally because it needs the full stack.

### Gaps

- **Thumbnail:** the kind declares `thumbnail: "runtime"`, but nothing draws runtime thumbnails yet. Ticket 161 records that this needs a contract route, so the grid shows the kind's icon until that lands.
- **Layout and full updates:** an update that sends the whole `content` drops the layout a person arranged. The instructions point the model to `edit` with `replace`, which keeps it.
- **Group boxes:** a group's box catches up with its nodes when a dragged node is dropped, not while it moves.
