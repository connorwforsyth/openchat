---
id: "064"
title: "Workspace editor text disappears after switching dark to light"
labels: [wayfinder:build]
status: open
assignee: loop
blockedBy: []
---

## Question

062's visual pass: after switching the colour scheme from dark to light while the app runs, the Workspace panel's code
editor (`packages/code-ui/src/code-editor.tsx`, built on the `@pierre/diffs` editor in a shadow root) rendered its text
invisible. It is probably the editor/Shiki theme not following the theme change.

## Done when

- The editor (and the read-only code viewers in code-ui that share the theming) follow light, dark and system theme
  changes live, with no reload: text is readable in both, before and after switching, including while a file is open.
- A browser test switches the theme with a file open and asserts the text colour contrasts with the background (or that
  the editor's theme attribute/variables flip).
- `e2e/README.md` mentions that the mock echoes mentioned workspace files (`[path: content]`).
- Gate passes; e2e passes.

## Owns

`packages/code-ui/src/**`, `packages/chat-ui/src/workspace/**` (theme plumbing only), `e2e/README.md`.
