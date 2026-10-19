---
id: "185"
title: "How does an Xcode project live in this bun monorepo across parallel worktrees?"
labels: [wayfinder:research]
status: open
map: "179"
assignee:
blockedBy: []
---

## Question

Agents work in sibling worktrees at once (AGENTS.md "Ways to hurt yourself"). Compare: a committed `.xcodeproj`, XcodeGen, Tuist, or an SPM-first layout with a thin app target, on merge conflicts, setup cost and agent-friendliness. Cover: running `xcodebuild test` from several worktrees at once (DerivedData paths, one simulator per worktree or `simctl clone`, memory), how `bun turbo` should see `apps/ios` (or not), lefthook `swift-format` / SwiftLint, Swift 6 strict concurrency, Swift Testing vs XCTest, and how the app points at a worktree's dev server port. Recommend a layout and the commands a ticket's "Done when" should name.

Findings: `.context/research/ios/xcode-monorepo.md` on branch `research/ios-xcode-monorepo`.
