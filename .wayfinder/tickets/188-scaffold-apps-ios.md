---
id: "188"
title: "apps/ios exists: it builds, tests, connects to an instance and shows its health"
labels: [wayfinder:build]
status: open
map: "179"
assignee:
blockedBy: ["185"]
---

## Question

The skeleton every later iOS ticket builds on, in the layout [Xcode research](185-xcode-in-the-monorepo.md) recommends.

## Done when

- `apps/ios` builds for the iOS 26 simulator with Swift 6 strict concurrency; one test passes via the documented `xcodebuild test` command.
- First launch asks for an instance URL, checks `GET /api/health` and `GET /api/config`, and shows the brand name from config (no codename in Swift sources; the brand guard covers `apps/ios`).
- The URL is switchable in Settings; every string goes through a String Catalog.
- lefthook runs `swift-format` on staged Swift; `AGENTS.md` gains a short iOS section (commands, ports).

## Owns

`apps/ios/**`, `lefthook.yml` (Swift entry), the iOS section of `AGENTS.md`, `scripts/ci/brand*` (to scan `apps/ios`).
