---
id: "185"
title: "How does an Xcode project live in this bun monorepo across parallel worktrees?"
labels: [wayfinder:research]
status: closed
map: "179"
assignee:
blockedBy: []
---

## Question

Agents work in sibling worktrees at once (AGENTS.md "Ways to hurt yourself"). Compare: a committed `.xcodeproj`, XcodeGen, Tuist, or an SPM-first layout with a thin app target, on merge conflicts, setup cost and agent-friendliness. Cover: running `xcodebuild test` from several worktrees at once (DerivedData paths, one simulator per worktree or `simctl clone`, memory), how `bun turbo` should see `apps/ios` (or not), lefthook `swift-format` / SwiftLint, Swift 6 strict concurrency, Swift Testing vs XCTest, and how the app points at a worktree's dev server port. Recommend a layout and the commands a ticket's "Done when" should name.

Findings: `.context/research/ios/xcode-monorepo.md` on branch `research/ios-xcode-monorepo`.

## Resolution (2026-10-20, research agent)

**XcodeGen + local Swift packages.** Code lives in packages under `apps/ios/Packages/`; a thin `App` target in `project.yml`; the `.xcodeproj` is generated and gitignored; committed `.xcconfig`s, with a gitignored `Local.xcconfig` for team id, bundle-id prefix and display name. **Parallel worktrees:** per-worktree `-derivedDataPath apps/ios/.build/DerivedData`, one fresh simulator named after the worktree, parallel testing off, simulator tests under the machine lock (`bun scripts/ci/browser-lock.ts --name ios-sim xcodebuild test …`); platform-neutral packages use `swift test` with no simulator. Commands are wrapped as `bun apps/ios/scripts/ios.ts test|lint|format|run`. **Monorepo:** no `package.json` in `apps/ios`, so turbo and Linux CI ignore it; lefthook runs `xcrun swift-format lint --strict`. **Swift 6** language mode, approachable concurrency, main-actor UI by default; Swift Testing for unit tests, XCTest for UI tests only. **Dev server:** the run script reuses `devPort(3000, "PORT")` and passes `-InstanceURL http://localhost:<port>`; needs `NSAllowsLocalNetworking`. **Blocker:** Xcode isn't installed (only CLT 16.3); Xcode 27.1 is current and runs on this Mac (macOS 26.6.2). Unverified until then: `simctl clone/create`, the skip-validation flags, simulator memory. Detail: `.context/research/ios/xcode-monorepo.md` on `research/ios-xcode-monorepo`.
