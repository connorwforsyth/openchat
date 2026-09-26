# 0002: bun with Expo autolinking and electron-builder native modules

- Status: accepted
- Date: 2026-09-26
- Ticket: [003](../../.wayfinder/tickets/003-risk-checks.md), `PLAN.md` §12 check 2
- Result: **PASS**, with two caveats (expo-doctor duplicates under the isolated linker; no
  native iOS compile on this machine)

## Context

bun runs installs, scripts and Turbo (D6). Mobile (Expo) and desktop (Electron with `node-pty`
for cowork mode, D7) are the two places bun's install layout most often breaks tooling. The
repo's `bun.lock` has `configVersion: 1` and a `node_modules/.bun` store, so it uses bun's
**isolated linker** (symlinked, pnpm-style), not a hoisted tree. The §12 fallback is pnpm just
for those apps, or pnpm workspaces.

## Check performed

All outside the repo, on macOS 26.6.2 arm64, bun 1.4.0, Node 22.19.0:

1. **Standalone Expo:** `bunx create-expo-app@latest --template default@sdk-57`, `bun install`,
   `expo-modules-autolinking resolve`, `expo prebuild --platform ios --no-install`,
   `expo-doctor`.
2. **Standalone Electron:** minimal `main.cjs` that spawns a shell through `node-pty` in the
   main process; `electron-builder install-app-deps`; run under `electron`; package with
   `electron-builder --mac --dir` (unsigned); run the packaged binary.
3. **Monorepo layout:** both apps copied into a bun workspace (`apps/mobile`,
   `apps/desktop`) installed with the isolated linker (as in the repo). Repeated autolinking,
   prebuild, `expo export --platform ios` with source maps (to check Metro bundles one copy of
   each module), `expo-doctor`, `install-app-deps`, a forced `electron-rebuild -f -o node-pty`,
   packaging and running the packaged app.
4. The same workspace installed with `bun install --linker hoisted`, then `expo-doctor` again.

Versions: `expo@57.0.25` (RN 0.86.3, React 19.2.3, expo-router 57.0.23), `electron@44.4.5`
(Node 24.21.0, ABI 149), `electron-builder@26.15.3`, `@electron/rebuild@4.2.0`,
`node-pty@1.1.0`.

## Evidence

**Expo autolinking resolves through bun's symlinked store:**

```text
ios modules: 20
/…/ws/node_modules/.bun/@expo+dom-webview@57.0.1+55f723cadd5f6c39/node_modules/@expo/dom-webview/ios
RN deps: @react-native-masked-view/masked-view,expo,react-native-gesture-handler,
         react-native-reanimated,react-native-safe-area-context,react-native-screens,react-native-worklets
✔ Finished prebuild          # Podfile contains use_expo_modules! and use_native_modules!
iOS Bundled … node_modules/expo-router/entry.js
```

The iOS source map has exactly one copy each of `expo`, `expo-modules-core`,
`expo-constants`, `react-native` and `react`.

**expo-doctor under the isolated linker:** 19/21. One failure is environmental (no CocoaPods
here). The other is `Check that no duplicate dependencies are installed`. bun creates
separate peer-variant directories of the same version, for example:

```text
Found duplicates for expo:
  ├─ expo@57.0.25 (at: node_modules/expo) → ../../node_modules/.bun/expo@57.0.25+569cfc0c52c829ff/…
  └─ expo@57.0.25 (at: ../../node_modules/.bun/expo-router@57.0.23+042a2120a4bb33e1/node_modules/expo)
```

Metro still bundled a single copy. With `bun install --linker hoisted` the same project
reports `21/21 checks passed. No issues detected!`

**Electron + node-pty** (standalone and inside the isolated workspace):

```text
• executing @electron/rebuild  electronVersion=44.4.5 arch=arm64 buildFromSource=false
• finished        moduleName=node-pty arch=arm64
electron=44.4.5 node=24.21.0 abi=149
pty output: "pty-ok 42\r\narm64" exit=0
• searching for node modules  pm=bun …
• note: bun does not support any CLI for dependency tree extraction, utilizing file traversal collector instead
…/app.asar.unpacked/node_modules/node-pty/build/Release/pty.node
$ ./dist/mac-arm64/…app/Contents/MacOS/electron-pty-spike
pty output: "pty-ok 42\r\narm64" exit=0
$ electron-rebuild -f -o node-pty
✔ Rebuild Complete
```

Notes:
- `bun pm untrusted` reported nothing blocked (`node-pty` is on bun's default trusted list).
- Electron 44 has no `postinstall`: its binary downloads on first run (or via
  `install-electron`), so bun's lifecycle-script policy does not affect it.

## Consequence for the plan

- **Keep bun workspaces.** The pnpm fallback is not needed for either app.
- **Desktop wave:**
  - add `"postinstall": "electron-builder install-app-deps"` in `apps/desktop`;
  - `node-pty` must stay unpacked from asar (electron-builder did this automatically);
  - CI needs the Electron binary download (first `electron` run or `install-electron`).
  - electron-vite was not part of this spike. It only affects bundling, not native module
    resolution.
- **Mobile wave, before building on it:**
  1. Run a real native build (`pod install` + `xcodebuild`, and Gradle). This machine has no
     Xcode or CocoaPods, so native compilation was not verified.
  2. Decide the linker. Either accept expo-doctor's duplicate warning (Metro deduplicates,
     shown above) or set `[install] linker = "hoisted"` in `bunfig.toml`. That is a
     repo-wide choice; it cleared the warning here.
