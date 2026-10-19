# Xcode in the bun monorepo, across parallel worktrees (ticket 185)

Researched 2026-10-20 for [map 179](../../../.wayfinder/ios-map.md). The
question is how `apps/ios` should live in this repo when several agents work
in sibling worktrees on one 16 GB laptop: project format, parallel
`xcodebuild test`, turbo and lefthook, Swift 6, Swift Testing, and how the app
reaches a worktree's dev server.

## The short version

- **Layout: XcodeGen + SPM-first.** Almost all code lives in local Swift
  packages under `apps/ios/Packages/`. A thin app target (entry point,
  Info.plist, assets, entitlements) is described in `apps/ios/project.yml`.
  The `.xcodeproj` is generated and **gitignored**. Build settings live in
  committed `.xcconfig` files. Personal values (team ID, bundle-ID prefix)
  live in a gitignored `Local.xcconfig`.
- **Tests:** platform-neutral packages run `swift test` on the Mac, with no
  simulator. The app and UI packages run `xcodebuild test` on **one named
  simulator per worktree**, with `-derivedDataPath` inside the worktree.
  That run sits behind the repo's existing machine-wide lock
  (`scripts/ci/browser-lock.ts --name ios-sim`), so only one simulator test
  run is up at a time.
- **Turbo doesn't see `apps/ios`:** it has no `package.json`, and CI is
  Ubuntu. That matches the map's "no iOS job in CI".
- **Format:** use `swift-format` from the toolchain (`xcrun swift-format`),
  not SwiftLint. Lefthook runs `lint --strict` on staged Swift.
- **Swift 6 language mode:** strict concurrency is always complete and
  violations are errors. Turn on approachable concurrency. Isolate UI code to
  `MainActor` by default and leave networking/core code `nonisolated`.
- **Tests use Swift Testing**; XCTest is only for UI tests.
- **Dev server:** the simulator shares the Mac's loopback. A worktree's
  server is at `http://localhost:<port>`, where the port is
  `scripts/ci/dev-port.ts`'s `devPort(3000, "PORT")`. The run script passes
  it to the app as a launch argument.
- **Blocker:** this Mac has **no Xcode installed**, only Command Line Tools
  16.3. Connor has to install Xcode 27.1 before ticket 188 can be done (see
  "Local toolchain").

---

## 1. Project format: committed `.xcodeproj` vs XcodeGen vs Tuist vs SPM-only

| | Committed `.xcodeproj` (buildable folders) | XcodeGen | Tuist | SPM-only (no project) |
|---|---|---|---|---|
| Source of truth | `project.pbxproj` (opaque, UUID-keyed) | `project.yml` (YAML) | `Project.swift` (Swift DSL) | `Package.swift` |
| Adding a file | No pbxproj change, using Xcode 16+ buildable folders [X16] | No change (`syncedFolder`) [XG] | No change (globs) | No change |
| Adding a target, extension or capability | Hand-edit pbxproj, or use the Xcode GUI | A few lines of YAML | A few lines of Swift | Can't: SPM has no iOS app, extension or entitlement targets |
| Merge conflicts | Rare for files; real for settings and targets | None (project gitignored) | None (project gitignored) | None |
| Setup per machine | None | `brew install xcodegen` | `mise use tuist@x` or brew [TU-INST] | None |
| Setup per worktree | None | `xcodegen generate` (under a second) | `tuist install && tuist generate` | None |
| Agent-friendliness | Weak: agents corrupt pbxproj when they edit it by hand | Strong: plain YAML, schema documented | Good, but a large DSL and fast churn | Strong, but can't ship an app |
| Maintenance (Oct 2026) | Apple | 2.46.0. Unreleased `main` adds `xcode27_0` format, fixes for Xcode 27.2 conversion, and synced-folder fixes [XG-CL] | CLI 4.214 canaries released several times a day [TU-REL]. MIT, except `server/` (MPL) [TU-LIC] | Apple |

**Why XcodeGen, and not a committed project.** Xcode 16's buildable folders
"only record the folder path into the project file without enumerating the
contained files... and avoid source control conflicts" [X16], so a committed
project is much less painful than it used to be. The map, though, already
names a notification-related extension (push, ticket 192 onward) and
entitlements (APNs, Keychain sharing). Adding a target by hand-editing pbxproj
is where agents fail, and with no Xcode GUI an agent has no other way. In YAML
it's a reviewable diff. XcodeGen has supported synced folders since 2.44, with
excludes, `explicitFolders` and `groupOrdering` since 2.45 [XG-CL]. So a
generated project with `type: syncedFolder` behaves like a hand-made Xcode 16+
project, and adding a file doesn't even need a regenerate.

**Why not Tuist.** Its strengths (module graphs, binary caching, selective
tests) pay off with dozens of modules, and its caching and analytics are
server features [TU-README]. We'll have one app target and two or three local
packages. Daily canary churn and a Swift DSL are more to keep in an agent's
head than one YAML file. Revisit only if the module count grows past ~10.

**Why SPM-first under it.** `Package.swift` files are text that merges cleanly.
`swift-openapi-generator` (ticket 184) is an SPM build plugin, so it needs a
package to live in anyway. Platform-neutral packages test with `swift test` on
the Mac, with no simulator and no lock, which is the fastest and most parallel
gate there is.

**Pin the generator.** Install XcodeGen with `brew install xcodegen` and
record the version in `project.yml`, using XcodeGen's `minimumXcodeGenVersion`
option. If Xcode 27's project format matters before the next XcodeGen release,
use `projectFormat: xcode16_3`. Xcode 27 opens older formats; `xcode27_0` is
only on XcodeGen `main` [XG-CL].

## 2. Recommended layout

```
apps/ios/
  project.yml                 # XcodeGen spec: one app target, test targets, schemes
  .gitignore                  # *.xcodeproj/ *.xcworkspace/ .build/ Config/Local.xcconfig *.xcresult
  .swift-format               # JSON config, found by walking up from each file [SF]
  Config/
    Base.xcconfig             # SWIFT_VERSION, concurrency, deployment target, warnings
    Debug.xcconfig            # #include "Base.xcconfig"  +  #include? "Local.xcconfig"
    Release.xcconfig
    Local.xcconfig.example    # DEVELOPMENT_TEAM, BUNDLE_ID_PREFIX, APP_DISPLAY_NAME (copied, gitignored)
  App/                        # thin target: synced folder
    AppEntry.swift            # @main; wires packages together, nothing else
    Info.plist
    App.entitlements
    Assets.xcassets/          # Colors generated from packages/ui globals.css (ticket 189)
    Localizable.xcstrings
  AppTests/                   # Swift Testing, hosted in the app (smoke tests only)
  AppUITests/                 # XCTest/XCUITest, added when needed
  Packages/
    Core/                     # platform-neutral: API client (openapi plugin), SSE parser,
      Package.swift           #   session, models. `swift test` on the Mac.
      Sources/…  Tests/…
    Features/                 # SwiftUI screens and components; iOS-only; tested via xcodebuild
      Package.swift
      Sources/…  Tests/…
  scripts/
    ios.ts                    # bun script: generate | sim | test | run | format | lint
```

Notes on the tree:

- **No codename anywhere in it.** The brand guard (`scripts/ci/brand.ts`)
  checks every tracked file outside `.wayfinder/`, `.github/`, `.context/`
  and `docs/decisions/`. It has no `apps/` filter, so it **already covers
  `apps/ios`**, including `project.yml`, plists and `.xcstrings`. That's why:
  - the target is named `App`;
  - the bundle ID is `$(BUNDLE_ID_PREFIX).app`;
  - `CFBundleDisplayName = $(APP_DISPLAY_NAME)`, with a neutral default in
    `Base.xcconfig` and the real name in the gitignored `Local.xcconfig`.

  Ticket 188's "Owns `scripts/ci/brand*`" may need no change. Check that the
  guard skips binary assets (`files.ts` `isBinary`).
- The `tokens` guard only scans `*.{js,ts,…,css}` (`SCANNED_FILE` in
  `scripts/ci/tokens.ts`), so the generated asset catalog's colour JSON won't
  trip it.
- `.build/` and `*.xcresult` stay inside `apps/ios` and are gitignored, so they
  never reach another worktree. The guards list only tracked and non-ignored
  files (`listGitFiles`), so they don't see them.

### Build settings (`Config/Base.xcconfig`)

```
IPHONEOS_DEPLOYMENT_TARGET = 26.0
SWIFT_VERSION = 6.0
SWIFT_APPROACHABLE_CONCURRENCY = YES
SWIFT_DEFAULT_ACTOR_ISOLATION = MainActor     // app target; see §5
SWIFT_TREAT_WARNINGS_AS_ERRORS = YES          // optional; matches "don't disable a rule to get green"
COMPILATION_CACHE_ENABLE_CACHING = YES        // optional, opt-in since Xcode 26 [X26]
PRODUCT_BUNDLE_IDENTIFIER = $(BUNDLE_ID_PREFIX).app
```

## 3. Running `xcodebuild test` from several worktrees at once

What collides when two worktrees test at once, and the fix for each:

| Resource | Default | Problem | Fix |
|---|---|---|---|
| DerivedData | `~/Library/Developer/Xcode/DerivedData/<Name>-<hash of project path>` | Different paths already get different folders. Wiping the shared parent (as cleanup scripts do) hits everyone, though, and the build is hard to find | `-derivedDataPath apps/ios/.build/DerivedData` [XB]. SwiftPM checkouts then live under it too, so they're per worktree |
| Simulator | Whatever `name=iPhone 17` matches | Two `xcodebuild`s installing and launching on one booted device clobber each other | One **named simulator per worktree**, addressed by UDID |
| Parallel testing clones | Xcode clones the chosen simulator per worker; "the original simulator is not used during testing" [WWDC18] | N clones × M worktrees booted at once runs a 16 GB Mac out of memory | `-parallel-testing-enabled NO` [XB]. Swift Testing still runs tests in parallel **in process**, using task groups [ST-PAR] |
| Memory, CPU | — | A booted simulator plus the build plus `next dev` plus another agent's `next build` | Machine-wide lock: `bun scripts/ci/browser-lock.ts --name ios-sim …` (ticket 140's named lock). `swift test` doesn't take it |

**`simctl clone` vs `simctl create`.** `xcrun simctl clone <udid> <name>`
copies an existing device with its state. `create` makes a clean one from a
device type and a runtime. Use **`create`**: we want a clean, reproducible
device per worktree, not a copy of whatever state the template had. (Verify
both subcommands with `xcrun simctl help` once Xcode is installed; this Mac
has no `simctl` yet.)

**Per-worktree simulator, idempotent.** The script runs this:

```sh
SIM="ios-$(basename "$(git rev-parse --show-toplevel)")"     # e.g. ios-t3-06a295e1
UDID=$(xcrun simctl list devices --json | jq -r --arg n "$SIM" '.devices[][] | select(.name==$n) | .udid' | head -1)
[ -n "$UDID" ] || UDID=$(xcrun simctl create "$SIM" com.apple.CoreSimulator.SimDeviceType.iPhone-17)
```

Without a runtime argument, `create` uses the newest installed iOS runtime.
Put that in `apps/ios/scripts/ios.ts` (bun + zod, like `scripts/ci/*`) rather
than a shell script, and reuse `readCheckout()` from `scripts/ci/dev-port.ts`
for the worktree path.

**Cleanup follows "Ways to hurt yourself" 1 and 4.** A worktree deletes only
**its own** simulator, by the UDID it created: `xcrun simctl delete "$UDID"`.
Never use `simctl delete unavailable`/`all`, and never `shutdown all`; another
agent's simulator is in use.

**Memory.** Neither Apple nor anyone else publishes per-simulator figures. As
an unmeasured estimate, a booted iOS simulator plus a Swift build of a small
app takes several GB. With `next dev` and up to three agents on 16 GB, the
`ios-sim` lock is the safe default. Measure with Activity Monitor on the first
real run before relaxing it. Xcode 27 runtimes now ship a pre-built dyld
cache, so first boot is "much faster" [X27].

## 4. The commands a ticket's "Done when" should name

Run from the worktree root. The canonical, spelled-out forms:

```sh
# 0. once per worktree, and after editing project.yml
(cd apps/ios && xcodegen generate)

# 1. fast gate: platform-neutral packages, no simulator, no lock
swift test --package-path apps/ios/Packages/Core

# 2. app + iOS packages on this worktree's simulator, one run per machine
bun scripts/ci/browser-lock.ts --name ios-sim \
  xcodebuild test \
    -project apps/ios/App.xcodeproj -scheme App \
    -destination "platform=iOS Simulator,id=$UDID" \
    -derivedDataPath apps/ios/.build/DerivedData \
    -parallel-testing-enabled NO \
    -skipPackagePluginValidation -skipMacroValidation \
    -resultBundlePath apps/ios/.build/Test.xcresult \
    -quiet

# 3. format check (what lefthook runs on staged files)
xcrun swift-format lint --strict --recursive --parallel apps/ios/App apps/ios/Packages

# 4. repo guards still pass (brand covers apps/ios)
bun run check:guards
```

Flag notes:

- `-skipPackagePluginValidation` and `-skipMacroValidation` stop
  command-line builds failing on the "trust this plugin/macro" prompt. The
  OpenAPI generator plugin (ticket 184/190) needs the first. These two flags
  come from `xcodebuild -help`, not the man page mirror; confirm them after
  installing Xcode.
- Because `xcodegen` puts `App.xcodeproj` beside `project.yml`, every command
  works the same in every worktree.
- `-only-testing:AppTests/<Suite>` narrows a run while iterating [XB].

Wrap them so tickets can name one line each. Ticket 188 should add:

```
bun apps/ios/scripts/ios.ts test     # 0 + 1 + 2, prints "[ios] simulator ios-<worktree> <UDID>"
bun apps/ios/scripts/ios.ts lint     # 3
bun apps/ios/scripts/ios.ts format   # xcrun swift-format format --in-place --recursive --parallel …
bun apps/ios/scripts/ios.ts run      # build, install, launch on this worktree's sim against its dev server (§7)
```

Wording for ticket 188's "Done when": *"`bun apps/ios/scripts/ios.ts test`
passes (XcodeGen generate, `swift test` on Core, and `xcodebuild test` on this
worktree's simulator under the `ios-sim` lock); `ios.ts lint` is clean."* Also
reword "builds for the iOS 26 simulator" as **deployment target iOS 26.0,
tested on the newest installed iOS simulator runtime**. Xcode 27 ships the
iOS 27 SDK [X27]. An iOS 26 runtime is an optional extra download
(`xcodebuild -downloadPlatform iOS -buildVersion 26.x`).

## 5. Swift 6 strict concurrency

- In the Swift 6 language mode, strict concurrency "is always 'complete' …
  and produces errors instead of warnings" [BS]. So `SWIFT_VERSION = 6.0` is
  the whole switch. No separate `SWIFT_STRICT_CONCURRENCY` is needed.
- `SWIFT_APPROACHABLE_CONCURRENCY = YES` turns on
  `DisableOutwardActorInference`, `GlobalActorIsolatedTypesUsability`,
  `InferIsolatedConformances`, `InferSendableFromCaptures` and
  `NonisolatedNonsendingByDefault` [BS]. The last one makes `async` functions
  "run in the caller's execution context" [S62].
- `SWIFT_DEFAULT_ACTOR_ISOLATION = MainActor` "infers `@MainActor` …
  to mitigate false-positive data-race safety errors in sequential code"
  [BS]. Swift 6.2 recommends it for UI code and executables [S62]. Use it for
  the app target and `Features`. Leave **`Core` `nonisolated`** (the default):
  the SSE parser and API client must not hop to the main actor.
- In packages (tools version 6.2+), per target, `swiftSettings:
  [.defaultIsolation(MainActor.self)]` [SE-0466]. Package targets default to
  the Swift 6 language mode at tools version 6.0+.
- Use `@concurrent` for work that should leave the caller's actor, e.g.
  decoding large payloads [S62].

## 6. Swift Testing vs XCTest

- **Swift Testing for all unit and integration tests.** It ships in Xcode 16+,
  is on by default in `swift test`, and bundles may mix it with XCTest [X16].
  Tests run in parallel in one process by default; `.serialized` opts a suite
  out [ST-PAR]. Use it for anything touching shared state such as
  `UserDefaults` or Keychain fakes.
- **XCTest only for UI tests** (XCUITest) and performance metrics. Xcode 27
  adds `XCUIVoiceOverService` for VoiceOver checks, and a runtime warning when
  one framework's assertion is used inside the other's test [X27].
- **No network in tests**, matching the repo rule (D9). Stub `URLSession` with
  a `URLProtocol` subclass and recorded JSON fixtures, the Swift equivalent of
  MSW. A test never needs the dev server.
- `swift test --maximum-repetitions N --repeat-until fail` (new in Xcode 27)
  hunts flaky tests [X27].

## 7. Turbo, lefthook, and the dev-server port

**Turbo: leave `apps/ios` out.** Give it no `package.json`. bun skips workspace
directories without one silently (checked: `bun install` 1.4.0 with
`apps/*` and a Swift-only `apps/ios` reports nothing). Then `bun turbo
typecheck lint test build` and CI (`ubuntu-latest` in `.github/workflows`)
never try to run Xcode. A package.json with `test: xcodebuild …` would break
every Linux CI run and every Mac without Xcode. The iOS gate is the per-ticket
local command in §4, as the map settles.

**Lefthook** (root `lefthook.yml`; lefthook ^2.1 is installed by `bun install`
through `prepare`). Add a job beside `ultracite` that is check-only, like
ultracite's:

```yaml
    - name: swift-format
      # Check only what is being committed; `bun apps/ios/scripts/ios.ts format` fixes.
      run: xcrun swift-format lint --strict {staged_files}
      glob: "apps/ios/**/*.swift"
```

- **swift-format over SwiftLint.** swift-format is in the toolchain: "Swift 6
  (included with Xcode 16) and above include swift-format" [SF]. So it adds no
  install, and `xcrun` picks the version that matches the selected Xcode. It
  both formats and lints, it reads `.swift-format` JSON from the nearest parent
  directory [SF], and `--parallel` uses every core [SF]. SwiftLint (0.65.1,
  Aug 2026 [SL]) is a Homebrew install with more opinionated rules and
  overlaps the formatter. Add it later only if a rule we want is missing.
- Use `xcrun swift-format` and never a Homebrew `swift-format`. Two versions
  format differently, and agents in two worktrees would fight over whitespace.
  Today, with `xcode-select` pointing at CLT, `xcrun` finds CLT 16.3's copy
  (Swift 6.1). After installing Xcode, select it (below) so everyone uses Swift
  6.4's.

**Pointing the app at a worktree's dev server.**

- `apps/web`'s `dev` is `bun ../../scripts/ci/dev-port.ts 3000 PORT next dev`.
  It prints `[next] http://localhost:<port> (…)`: 3000 in the main checkout,
  `3000 + 1000..2999` hashed from the path in a linked worktree, with `PORT`
  winning (ticket 140, `scripts/ci/dev-port.ts`).
- The simulator shares the Mac's network stack, so
  `http://localhost:<that port>` reaches it.
- `ios.ts run` imports `devPort(3000, "PORT")` from `scripts/ci/dev-port.ts`.
  This is the same function, so it agrees with `bun dev` without parsing
  output. It then launches with
  `xcrun simctl launch "$UDID" "$BUNDLE_ID" -InstanceURL http://localhost:$PORT`.
  `-Key value` launch arguments land in `UserDefaults`' argument domain, so
  the first-launch screen can prefill or skip the URL in Debug builds. A
  stored URL from Settings still wins unless the argument is present.
- **ATS:** from iOS 17, "ATS no longer allows connections to IP addresses by
  default" [ATS]. `localhost` is an unqualified domain. Set
  `NSAppTransportSecurity.NSAllowsLocalNetworking = YES`, which allows
  "unqualified domains, `.local` domains, and IP addresses" [ATS]. Since
  self-hosted instances on a LAN are a real case, consider keeping it in
  Release too. That's a product call for ticket 188/190.
- **A physical phone** can't use `localhost`. Use `http://<mac>.local:<port>`
  with `next dev -H 0.0.0.0` (not today's default script) and an
  `NSLocalNetworkUsageDescription` string. Leave this for the demo-gate
  ticket.
- Tests never use the dev server (§6). `xcodebuild test` passes values to
  test runners through `TEST_RUNNER_<VAR>` environment variables [XB] if a UI
  test ever needs one.

## 8. Local toolchain (this Mac, checked read-only 2026-10-20)

| Item | Found |
|---|---|
| macOS | 26.6.2 (25G83), Apple silicon, 10 cores, 16 GB RAM, 146 GB free |
| Xcode | **Not installed.** `xcode-select -p` → `/Library/Developer/CommandLineTools`; `xcodebuild` errors "requires Xcode" |
| CLT | 16.3 (`CLTools_Executables` 16.3.0.0.1); `swift` 6.1 (swiftlang-6.1.0.110.21) |
| `xcrun simctl` | Not available (needs Xcode). `~/Library/Developer/CoreSimulator/Devices` holds 10 device folders left from an earlier install |
| `swift-format` | Not on `PATH`; `/Library/Developer/CommandLineTools/usr/bin/swift-format` exists (`--version` prints `main`) |
| xcodegen, tuist, swiftlint, mise, xcbeautify | Not installed. `brew` is at `/opt/homebrew/bin/brew` |
| lefthook | Not global; comes from `node_modules` via `bun install` (`"prepare": "lefthook install"`) |
| bun | 1.4.0 |

Current Apple releases [REL]:

- Xcode 27.1 (27A9275, 2026-10-15) is the newest. Xcode 27 shipped
  2026-09-14, and 27.2 is in beta.
- Xcode 27 "includes Swift 6.4 and SDKs for iOS 27 …" and "requires a Mac
  running macOS Tahoe 26.6 or later" [X27]. This Mac qualifies.
- Xcode 27 runs only on Apple silicon [X27].

**One-time setup Connor has to do** (HITL, before ticket 188; it fits beside
ticket 186's Apple account work):

```sh
# install Xcode 27.1 from the App Store or developer.apple.com/download, then:
sudo xcode-select -s /Applications/Xcode.app
sudo xcodebuild -license accept
xcodebuild -runFirstLaunch
xcodebuild -downloadPlatform iOS          # if the iOS 27 simulator runtime isn't already present
brew install xcodegen jq
xcodebuild -version && xcrun simctl list runtimes && xcrun swift-format --version   # record in AGENTS.md iOS section
```

Optional: Xcode 27 adds an MCP server that runs without an open workspace
(`sudo xcrun mcp-server enable`, still a preview). Through it, agents can boot
simulators, tap and screenshot [X27]. It's worth trying for UI verification,
but don't make a gate depend on it.

## 9. Changes this implies for other tickets

- **188:** owns `apps/ios/**` per §2, plus `lefthook.yml` (§7) and the AGENTS.md
  iOS section, which should list the four `ios.ts` commands, the port line,
  and "delete only your own simulator". Its brand-guard change is probably a
  no-op (§2). Reword the simulator line (§4).
- **184/190:** put the OpenAPI generator in `Packages/Core` as a build plugin.
  CLI builds need `-skipPackagePluginValidation`.
- **189:** the generated `.xcassets` colours sit in `App/Assets.xcassets` or in
  `Features` resources. The tokens guard doesn't scan them.

## Sources

- [X16] Xcode 16 release notes (buildable folders, Swift Testing): https://developer.apple.com/documentation/xcode-release-notes/xcode-16-release-notes
- [X26] Xcode 26 release notes (Swift 6.2, compilation caching, synced-folder ordering fix): https://developer.apple.com/documentation/xcode-release-notes/xcode-26-release-notes
- [X27] Xcode 27 release notes (Swift 6.4, macOS 26.6 minimum, simulator, testing, MCP server): https://developer.apple.com/documentation/xcode-release-notes/xcode-27-release-notes
- [REL] Apple Developer releases (Xcode 27.1 27A9275, 2026-10-15): https://developer.apple.com/news/releases/
- [BS] Xcode build settings reference (`SWIFT_STRICT_CONCURRENCY`, `SWIFT_APPROACHABLE_CONCURRENCY`, `SWIFT_DEFAULT_ACTOR_ISOLATION`, `COMPILATION_CACHE_ENABLE_CACHING`): https://developer.apple.com/documentation/xcode/build-settings-reference
- [S62] Swift 6.2 released: https://www.swift.org/blog/swift-6.2-released/
- [SE-0466] Control default actor isolation inference: https://github.com/swiftlang/swift-evolution/blob/main/proposals/0466-control-default-actor-isolation.md
- [ST-PAR] Swift Testing, Running tests serially or in parallel: https://developer.apple.com/documentation/testing/parallelization
- [XB] `xcodebuild(1)` (`-derivedDataPath`, `-parallel-testing-*`, `-only-testing`, `TEST_RUNNER_`), mirror of the Xcode man page: https://keith.github.io/xcode-man-pages/xcodebuild.1.html
- [WWDC18] What's New in Testing (parallel testing, simulator clones): https://developer.apple.com/videos/play/wwdc2018/403/
- [ATS] `NSAllowsLocalNetworking`: https://developer.apple.com/documentation/bundleresources/information-property-list/nsapptransportsecurity/nsallowslocalnetworking
- [SF] swift-format README: https://github.com/swiftlang/swift-format
- [SL] SwiftLint releases: https://github.com/realm/SwiftLint/releases
- [XG] XcodeGen: https://github.com/yonaskolb/XcodeGen ; [XG-CL] changelog: https://github.com/yonaskolb/XcodeGen/blob/master/CHANGELOG.md
- [TU-REL] Tuist releases: https://github.com/tuist/tuist/releases ; [TU-LIC] license: https://github.com/tuist/tuist/blob/main/LICENSE.md ; [TU-README] https://github.com/tuist/tuist ; [TU-INST] https://tuist.dev/en/docs/guides/install-tuist
- Repo: `scripts/ci/dev-port.ts`, `scripts/ci/browser-lock.ts` (ticket 140), `scripts/ci/brand.ts`, `scripts/ci/tokens.ts`, `scripts/ci/lib/files.ts`, `lefthook.yml`, `turbo.json`, `.github/workflows/`, `apps/web/package.json`.
