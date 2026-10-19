---
id: "179"
title: "Collapsed rail"
labels: [wayfinder:build]
status: in-progress
assignee: loop
blockedBy: ["177"]
---

## Question

From the study (B4; idea 10): collapsed isn't hidden, it's an icon rail.

## Done when

- collapsing leaves a 48px icon rail (New chat, Search, Dot, needs-attention count, Artifacts, Dots, Library, account);
- peek still opens the full sidebar from the rail's edge;
- the saved layout restores rail vs open (the rail shows whenever the sidebar is collapsed);
- the rail has no animation on keyboard toggle (motion rule).
- **Tests:** browser-mode tests for the rail.

## Owns

`packages/chat-ui/src/sidebar/sidebar-rail.tsx`, `packages/chat-ui/src/shell/app-shell.tsx` (a `rail` slot), `apps/web` shell hosts.
