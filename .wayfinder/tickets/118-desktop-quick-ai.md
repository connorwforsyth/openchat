---
id: "118"
title: "Desktop Quick AI: a global-shortcut window"
labels: [wayfinder:build]
status: in-progress
assignee: loop
blockedBy: ["116"]
---

## Question

Desktop wave (`PLAN.md` §2 Desktop, D7 cowork, D14 Quick AI and title bar, D24 IPC rules, D28 desktop renderer). Connor said "keen to start desktop" (2026-10-02); the loop treats it as M1 sign-off for planning — he confirms in 122.

## Done when

- A global shortcut (configurable; default ⌥Space) opens a small floating composer window anywhere. Send starts a chat on the instance; Escape hides it; ⏎ with ⌘ opens it in the main window.
- The tray offers the same thing. Lives in Electron main, reuses the composer. Tests and gate pass.

## Owns

`apps/desktop/**`.
