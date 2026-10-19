---
id: "194"
title: "Connor installs Xcode 27.1 and an iOS simulator runtime"
labels: [wayfinder:task]
status: open
map: "179"
assignee:
blockedBy: []
---

## Question

[Xcode research](185-xcode-in-the-monorepo.md) found only Command Line Tools 16.3 on this Mac, so `xcodebuild` and `simctl` don't work. HITL checklist (setup commands in `.context/research/ios/xcode-monorepo.md` §8 on `research/ios-xcode-monorepo`):

1. Install Xcode 27.1 (App Store or developer.apple.com); open it once to accept the licence and install components.
2. `sudo xcode-select -s /Applications/Xcode.app`.
3. Install the iOS simulator runtime; `brew install xcodegen`.
4. Confirm `xcodebuild -version` and `xcrun simctl list runtimes`.

Resolution records the versions, and whether `simctl clone`/`create` and the skip-validation flags behave as the research assumed.
