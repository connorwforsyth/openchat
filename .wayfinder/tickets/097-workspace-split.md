---
id: "097"
title: "Workspace panel: the browser on top, the files below"
labels: [wayfinder:build]
status: open
assignee: loop
blockedBy: []
---

## Question

Connor asked (2026-10-01) to separate the file viewer from the browser preview: the browser on top and the files on the bottom. Today `MainArea` in `packages/chat-ui/src/workspace/workspace-panel.tsx` switches one main area between a file, an artifact and the preview, with a list beside it (070 flattened it, now on `main`).

## Done when

- The panel is a vertical split: the **browser** (`BrowserView`, the preview) on top and the **files** (tree, and the open file's editor or rendered view) below, with a draggable divider (keyboard-operable, double-click resets, position saved per user like the sidebar width from 071).
- When there's nothing to preview yet, the browser half collapses to a slim bar (or hides) so files get the whole height; it opens on its own when a page or server appears, as it does today.
- Either half can be maximised and restored. At narrow widths (under ~420px) the halves take turns instead of stacking, keeping 070's back-to-the-list behaviour.
- Opening an HTML file still previews it in the browser half; opening other files shows them in the files half. Artifacts keep working where they are today (their future is a separate decision).
- Focus and Escape behave as 070 set up. e2e covers: split visible with a preview, resize and reload keeps it, narrow width takes turns, a file opens below while the preview stays above. Gate and e2e pass. No `packages/contract` change.

## Owns

`packages/chat-ui/src/workspace/**`, `packages/chat-ui/src/model/workspace.ts`, `packages/i18n/locales/**`, `e2e/tests/workspace*.spec.ts`, `e2e/support/**` (helpers only).
