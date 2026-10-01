---
id: "117"
title: "Desktop native chrome: title bar, menus from the shortcut registry, tray"
labels: [wayfinder:build]
status: open
assignee:
blockedBy: ["116"]
---

## Question

Desktop wave (`PLAN.md` §2 Desktop, D7 cowork, D14 Quick AI and title bar, D24 IPC rules, D28 desktop renderer). Connor said "keen to start desktop" (2026-10-02); the loop treats it as M1 sign-off for planning — he confirms in 122.

## Done when

- **Title bar (D14):** macOS `titleBarStyle: 'hiddenInset'`, with the header as the drag region (`no-drag` on controls). Windows and Linux use a matching custom bar with window controls.
- **Menus:** native menus generated from `packages/shortcuts` (the same accelerators as the web: ⌘K, new chat, stop, toggle sidebar, switch model, copy last reply).
- **Tray / menu-bar icon:** New chat, Quick AI, Quit.
- Window state remembered. Tests for the menu-from-registry mapping. Gate passes.

## Owns

`apps/desktop/**`, `packages/shortcuts/**` (Electron accelerator mapping).
