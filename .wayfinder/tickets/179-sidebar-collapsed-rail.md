---
id: "179"
title: "Collapsed rail"
labels: [wayfinder:build]
status: closed
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

## Resolution (2026-10-20, branch t/181-sidebar-ux)

`sidebar/sidebar-rail.tsx` and an `AppShell` `rail` slot: collapsed on a wide screen shows a 48px rail (New chat, Search, your Dot's face, a needs-attention count that jumps to the next one, Artifacts, Dots, Library, account avatar). No transition; peek's edge sits beside the rail. The header's own toggle reopens the sidebar (a rail toggle would sit under the desktop traffic lights). The saved layout already restores collapsed, so the rail comes back with it.
