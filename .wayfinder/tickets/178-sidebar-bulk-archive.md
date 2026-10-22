---
id: "178"
title: "Bulk select, the archive view and the archive suggestion"
labels: [wayfinder:build]
status: closed
assignee: loop
blockedBy: ["177"]
---

## Question

From the study (B2; idea 9).

## Done when

- ⇧/⌘-click selects rows, and archive applies to the selection with a partial-failure toast;
- the sidebar's "Archived" view searches and unarchives;
- after 3 archives within one date group, it offers "Archive the remaining N?".
- **Tests:** a pure selection reducer, and browser-mode tests.

## Owns

`packages/chat-ui/src/sidebar/**` (new `selection.ts`, archive view in `chat-sidebar.tsx`, `use-sidebar-data.ts`).

## Resolution (2026-10-20, branch t/181-sidebar-ux)

`sidebar/selection.ts` reducer (toggle, range, clear, prune); ⌘/Ctrl-click and ⇧-click pick rows, a bar shows "N selected · Archive · ×", Escape clears. Bulk archive is optimistic with an "Archived N; M failed" toast (`useSidebarData.onArchiveMany`). The Archived view (archive icon beside the sort menu) lists archived chats with search and Unarchive. After 3 archives in one date group a toast offers to archive the rest. Bulk delete isn't offered (no delete in the row menu yet).
