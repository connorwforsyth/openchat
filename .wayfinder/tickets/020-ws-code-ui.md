---
id: "020"
title: "WS-code-ui: file tree, code and diff views"
labels: [wayfinder:build]
status: closed
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

## Resolution (2026-09-27, loop)

Built in [PR #10](https://github.com/connorwforsyth/openchat/pull/10): `packages/code-ui` with `FileTree` (@pierre/trees, icons from the registry via a runtime sprite), `CodeView`, `DiffView` (per-hunk accept/reject with comments, emits the contract's `review` decision), `CodeHeader`, `CodeUiProvider` (2-worker Shiki pool). A generated Shiki theme uses only `var(--token)`/`color-mix`, so re-theming needs no re-highlight. 33 tests; `/dev/code` demo. Verified: 41/41 turbo tasks, empty-env `/dev/code` 200, browser check of accept/reject, CI passed. Open: a `--success` token for diff additions (question 10); line comments are always empty (per-hunk comments only).
