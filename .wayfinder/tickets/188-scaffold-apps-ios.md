---
id: "188"
title: "apps/ios exists: it builds, tests, connects to an instance and shows its health"
labels: [wayfinder:build]
status: open
map: "179"
assignee:
blockedBy: ["194"]
---

## Question

The skeleton every later iOS ticket builds on, in the layout [Xcode research](185-xcode-in-the-monorepo.md) recommends.

## Done when

- `apps/ios` follows the research layout (XcodeGen `project.yml`, code in `apps/ios/Packages/`, generated `.xcodeproj` gitignored, `Local.xcconfig` gitignored); deployment target iOS 26.0, Swift 6 language mode.
- `bun apps/ios/scripts/ios.ts test|lint|format|run` work; `test` runs `swift test` for the packages and the simulator tests under `browser-lock.ts --name ios-sim`; `run` points the app at this worktree's dev port.
- First launch asks for an instance URL, checks `GET /api/health` and `GET /api/config`, and shows the brand name from config (no codename in Swift sources; the brand guard already scans `apps/ios`).
- The URL is switchable in Settings; every string goes through a String Catalog.
- lefthook runs `swift-format` on staged Swift; `AGENTS.md` gains a short iOS section (commands, ports).

## Owns

`apps/ios/**`, `lefthook.yml` (Swift entry), the iOS section of `AGENTS.md`, `.gitignore` entries for `apps/ios`.
