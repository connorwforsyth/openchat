---
id: "178"
title: "Bulk select, the archive view and the archive suggestion"
labels: [wayfinder:build]
status: in-progress
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
