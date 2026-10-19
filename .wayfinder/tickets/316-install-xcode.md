---
id: "316"
title: "Connor installs Xcode 27.1 and an iOS simulator runtime"
labels: [wayfinder:task]
status: open
map: "300"
assignee: connor
blockedBy: []
---

## Question

[Xcode research](307-xcode-in-the-monorepo.md) found only Command Line Tools 16.3 on this Mac, so `xcodebuild` and `simctl` don't work. Connor's checklist, assigned to Connor so the loop skips it (setup commands in `.context/research/ios/xcode-monorepo.md` §8):

1. Install Xcode 27.1 (App Store or developer.apple.com); open it once to accept the licence and install components.
2. `sudo xcode-select -s /Applications/Xcode.app`.
3. Install the iOS simulator runtime; `brew install xcodegen`.
4. Confirm `xcodebuild -version` and `xcrun simctl list runtimes`.

Resolution records the versions, a measured memory figure for one booted simulator plus a build, and whether `simctl clone`/`create` and the skip-validation flags behave as the research assumed.
