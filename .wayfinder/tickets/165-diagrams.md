---
id: "165"
title: "Diagrams and flowcharts: a `diagram` kind people can edit, on React Flow"
labels: [wayfinder:build]
status: open
assignee:
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
