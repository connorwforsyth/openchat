---
id: "020"
title: "WS-code-ui: file tree, code and diff views"
labels: [wayfinder:build]
status: open
assignee:
blockedBy: ["007","008"]
---

## Question

`FileTree`, `CodeView` and `DiffView` over @pierre/trees and @pierre/diffs, themed from
`packages/ui` tokens (with a generated Shiki theme) and fed icons from the registry; per-hunk
accept/reject wired to write/edit tool results (`PLAN.md` D16, D19).

## Owns

`packages/code-ui`.

## Done when

`PLAN.md` §11 M1 step 7 passes; re-theming with `shadcn apply` changes the code views too.
