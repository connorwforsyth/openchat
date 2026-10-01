---
id: "119"
title: "Desktop packaging and auto-update"
labels: [wayfinder:build]
status: in-progress
assignee: loop
blockedBy: ["116"]
---

## Question

Desktop wave (`PLAN.md` §2 Desktop, D7 cowork, D14 Quick AI and title bar, D24 IPC rules, D28 desktop renderer). Connor said "keen to start desktop" (2026-10-02); the loop treats it as M1 sign-off for planning — he confirms in 122.

Signing and notarising macOS builds needs an Apple Developer account (paid); Windows signing needs a certificate (paid). The loop spends nothing, so this ticket ships unsigned builds and documents signing, until Connor decides (122).

## Done when

- electron-builder config for macOS (dmg, arm64 + x64), Windows (nsis) and Linux (AppImage), with the instance's brand (name, icon, app ID) read from the brand block.
- Auto-update via GitHub Releases, wired but off until builds are signed. A local `bun run desktop:package` produces unsigned artifacts.
- Docs: how to sign and notarise once accounts exist. Gate passes.

## Owns

`apps/desktop/**` (build config), `docs/desktop.md`.
