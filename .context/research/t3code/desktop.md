I read tickets 116–122, openchat's `apps/desktop` (source, scripts, `e2e/desktop`) and T3 Code's desktop, packaging, `native/`, `infra/relay`, release workflows and docs. I edited nothing in either repo.

# T3 Code desktop vs openchat desktop

## 1. The architectures differ at the root

**T3:** the desktop app is a local host. Electron main (`apps/desktop/src/main.ts`) builds an Effect layer graph of about 40 services. It supervises a bundled Node server, loads its own built web client over a custom scheme (`t3code://app`, `src/electron/ElectronProtocol.ts`), and can expose that server to other devices.

**openchat:** verified against ticket 122 ("instance URL only. No local server") and 116's design change. `apps/desktop/src/main/index.ts` (549 lines) loads the instance's own web app in a `BrowserWindow` on the `persist:instance` partition. The only local renderer is the first-run screen (`src/renderer/setup-screen.tsx`). No server is bundled and none is spawned.

So the server supervision, ports, host exposure, WSL, SSH and relay parts of T3 don't apply to openchat today. They only matter if cowork (120) comes back.

## 2. Things openchat already does as well or better (keep them)

| Area | T3 | openchat |
|---|---|---|
| Electron fuses | None found in `scripts/build-desktop-artifact.ts`. It can't turn RunAsNode off, because it runs its server and helper workers with `ELECTRON_RUN_AS_NODE=1` (`backend/DesktopBackendConfiguration.ts`, `snapShot/*Process.ts`). | RunAsNode, NODE_OPTIONS and `--inspect` off; ASAR integrity and OnlyLoadAppFromAsar on (`scripts/builder-config.ts`, `electronFuses`). |
| Single instance | No `requestSingleInstanceLock` anywhere in the repo, even though `app/DesktopClerk.ts` listens for `second-instance`. | Locked in `index.ts`. |
| IPC validation | Main side decodes with `DesktopIpc.makeIpcMethod`, which applies Schema to both payload and result (good). The preload casts with `as` (`src/preload.ts`), and most handlers check `event.sender.id` at most, not `senderFrame`. | Zod on both sides (`src/shared/ipc.ts`), plus main-frame sender checks for the setup and Quick AI channels. |
| Permissions | Only the preview `BrowserSession` sets permission handlers. | Deny by default on every session (`security.ts`, `shared/navigation.ts`), and devices are refused. |
| Smoke tests | `apps/desktop/scripts/smoke-test.mjs` launches Electron for 8 seconds and greps the logs for "Cannot find module" and similar. | Real Playwright `_electron` end to end (`e2e/desktop/smoke.spec.ts`, 613 lines) plus a packaged CDP smoke that checks fuses (`scripts/smoke-packaged.ts`). |
| Code style | Effect services and classes throughout. | Pure rules in `src/shared` behind a thin shell, which matches D8. Don't copy T3's Effect layering. |

## 3. Ideas worth adopting, by value

### 1. Test the updater locally with a mock update server (affects 119)
- **T3:** `scripts/mock-update-server.ts` is a static file server, safe against path traversal, that serves `release-mock/`. A build with `T3CODE_DESKTOP_MOCK_UPDATES=1` gets `publish: [{provider:"generic", url:"http://localhost:3000"}]` (`build-desktop-artifact.ts` ~L2676). At runtime the same flag forces `setFeedURL` to localhost (`updates/DesktopUpdates.ts` L918, `app/DesktopConfig.ts` L60). The two pieces exercise check, download and install end to end with no GitHub.
- **openchat:** `src/main/updates.ts` is 45 lines. The update path was only "verified" by watching it fail behind a dead proxy (119 Results).
- **Adopt:** add a `DESKTOP_UPDATE_URL` (generic provider) option to `builder-config.ts`. Then package v0.0.1 and v0.0.2 and have `smoke-packaged.ts` serve the newer one from a temp directory and assert `update-available` and `update-downloaded`.
- **Limit:** on macOS, Squirrel.Mac won't *apply* an update to an ad-hoc-signed app. So the install step can only be tested on Linux (AppImage) until there's a Developer ID. That fits 122's "signing later".

### 2. An update state machine and visible update UI (119 follow-up)
- **T3:** `updates/updateMachine.ts` holds pure reducers over a `DesktopUpdateState`: disabled, checking, available, downloading, downloaded, error, plus `canRetry`. Behaviour:
  - no automatic download;
  - checks 15 seconds after start, then every 4 minutes;
  - the renderer shows a "rocket" button: one click downloads, the next restarts;
  - release notes are sanitised and capped (`updates/releaseNotes.ts`);
  - it detects an x64 build running under Rosetta (`runningUnderArm64Translation`) so it can steer those users to arm64.
- **openchat:** `autoDownload = true`, install on quit, no UI. The person never learns an update is waiting.
- **Adopt:** a discriminated-union `UpdateState` reducer in `src/shared` (it fits D8) and native menu items ("Check for Updates…", "Restart to Update"). That needs no web change. A bridge `onUpdateState` for an in-app pill can come later; it would touch `packages/shortcuts/src/desktop.ts`.

### 3. A preload bundle guard in CI (116 hardening)
- **T3:** `apps/desktop/scripts/verify-preload-bundle.mjs` runs in `ci.yml` L130. It parses the built preload with acorn, rejects dynamic `import()` and `require()`, runs it in a `node:vm` with only the modules a sandboxed preload can reach, and checks the expected bridge keys.
- **openchat:** both preloads are sandboxed, and `instance.ts` imports zod and `@workspace/shortcuts/ids`. Any regression, such as pulling in Lingui or a Node built-in, is only caught by `test:desktop`. That suite is macOS-only and not in `.github/workflows/ci.yml`, which runs everything on `ubuntu-latest`.
- **Adopt:** a vitest test that loads `dist/preload/*.cjs` into a vm with a stub `electron` (`contextBridge`, `ipcRenderer`) and asserts the exact `window.desktop` shape. It's cheap and runs on Linux CI.

### 4. Windows and Linux title bar via a transparent overlay (117 open item)
- **T3:** `window/DesktopWindow.ts` L254–275 uses `titleBarStyle:"hidden"` with `titleBarOverlay:{color:"#01000000", height:40, symbolColor}`. The comment explains why: `#00000000` breaks on Linux. Only `symbolColor` follows `nativeTheme`, through `syncWindowAppearance`. The overlay itself is transparent, so main never needs the page's theme colours.
- **openchat:** 117 is open on "the Windows and Linux custom bar needs colours from the theme in main".
- **Adopt:** use the transparent overlay, which removes that blocker. The hex literal will need a `ci-guard-ignore tokens:` comment, because the `tokens` guard covers `apps/`.

### 5. Traffic-light inset that survives zoom (117)
- **T3:** `src/preload.ts` L33–44 sets `--desktop-window-controls-inset` to `90 / webFrame.getZoomFactor()` px on load and on resize. Native window buttons don't scale with Chromium zoom.
- **openchat:** a fixed 80 px inset (117). After ⌘+ or ⌘−, the header's reserved space no longer matches the lights.
- **Adopt:** have the instance preload publish the same CSS variable, and have chat-ui read it with 80 px as the fallback.

### 6. Notifications and Dock badge (new; touches 116's permission rules)
- **T3:** the web side posts notifications (`apps/web/src/components/ThreadNotificationCoordinator.tsx`) and calls `setNotificationBadge`. Main (`ipc/methods/notificationBadge.ts`):
  - validates the count, and a PNG data URL capped at 16 KB;
  - sets the badge count on macOS and Linux, and a Windows overlay icon;
  - zeroes it while a window has focus.
- **openchat:** `shared/navigation.ts` denies `notifications`.
- **Adopt:** when the web app gets "reply finished" notifications, allow `notifications` for the instance origin only and add a validated `setBadge` bridge call. This is a real fit for a chat app whose runs keep streaming in the background (Quick AI already does).

### 7. System-browser sign-in with deep links (deferred PKCE in 116)
- **T3:** `app/DesktopClerk.ts` L189–200 handles callbacks from both `open-url` (macOS) and `second-instance` argv (Windows and Linux), and only accepts destinations under its own scheme. `app/DesktopLinuxUrlHandler.ts` writes its own `.desktop` handler for the current AppImage and runs `xdg-mime`, because `setAsDefaultProtocolClient` can't match AppImageLauncher's renamed entries.
- **openchat:** `builder-config.ts` declares `protocols` from `brand.urlScheme`, but there is no `open-url` or argv handling. OAuth and SSO leave the window (116 open item).
- **Adopt:** when `@better-auth/electron` lands, mirror T3's two entry points and its origin check. Plan for the Linux AppImage workaround before shipping Linux.

### 8. Release channels and per-arch manifests (119, later)
- **T3:** `.github/workflows/release.yml` and `release-desktop.yml`:
  - stable, nightly and preview trains;
  - stable promotes the latest nightly's commit;
  - nightly uses `channel: "nightly"` and prerelease feeds;
  - preview and PR builds get **no publish config, so no `app-update.yml`** (`isDesktopPreviewVersion`), which keeps hand-downloaded builds off the update feeds;
  - signing is auto-detected from secrets: Developer ID plus notarisation on macOS, Azure Trusted Signing on Windows;
  - per-arch jobs run on native hardware, and `scripts/merge-update-manifests.ts` merges the per-arch `latest-mac.yml` files.
- **openchat:** packaging is local only, and auto-update is gated by `DESKTOP_AUTO_UPDATE` plus a repo variable.
- **Adopt later:**
  - the "test builds carry no feed" rule;
  - building both mac arches in one electron-builder run, as openchat does now, which avoids the manifest merge;
  - copying T3's "unset empty `CSC_*` variables" step (`build-desktop-artifact.ts` ~L3759) when CI packaging lands.
- Azure Trusted Signing is a paid service (Connor decides, per 122 and AGENTS.md).

### 9. Smaller ideas
- **First paint:** `backgroundThrottling:false` until first show, then back on (`DesktopWindow.ts` L408–415, L819). It speeds the first paint of a `show:false` window. That could help Quick AI's hidden window, which sizes itself from the page's preferred-size events.
- **Quit guard:** `window/QuitHold.ts` offers hold-or-double-press ⌘Q to quit, configurable. It's useful once runs stream in the background. Low priority.
- **Logs:** T3 writes a log file per component and per backend (`app/DesktopObservability.ts`). openchat only uses `console.error`, so a packaged user can't attach logs. A `userData/logs` file would help bug reports.

## 4. Cowork (120, parked): what to borrow if it comes back

D7 puts an agent loop, node-pty and local stdio MCP on the desktop. That is T3's core problem, and its supervisor is the reference:

- **Supervision** (`backend/DesktopBackendManager.ts`):
  - restart backoff from 500 ms up to 10 s;
  - stop after 5 fatal preflight failures and show the reason;
  - HTTP readiness probe (`/.well-known/t3/environment`, 1 minute timeout);
  - SIGTERM, then a forced kill after 2 s;
  - a 5 s output drain into rotating per-instance logs.
- **Bootstrap without argv or env:** a JSON envelope (including `desktopBootstrapToken`) goes in on **fd 3**, with telemetry on fd 4 and fd 5 (`resolvePrimaryStartConfig`). Secrets never show in `ps` or the environment.
- **Port:** scans from 3773 upward (`app/DesktopApp.ts` L36–103). Binds to loopback by default.
- **Native packaging:** natives go in `asarUnpack`. Windows uses a `server.asar` sidecar, and the build *verifies* every unpacked native exists and loads (`build-desktop-artifact.ts` ~L3184–3216; `docs/operations/release.md` "Windows payload topology"). node-pty ships per arch.
- **Rust resource monitor** (`native/resource-monitor/src/main.rs`, `docs/internals/resource-telemetry.md`): a separate `sysinfo` child process speaking a versioned JSON-lines protocol, with history bounded by age, count, entries and bytes. It exists to keep collector crashes out of Node and to avoid a native-addon ABI matrix across Node and Electron. It only samples while diagnostics has live subscribers. openchat would only need this for cowork's process tree; skip it otherwise.
- **The fuse conflict.** T3 needs `ELECTRON_RUN_AS_NODE`, but openchat has that fuse off. Use Electron's `utilityProcess.fork` for a local agent loop instead, keeping the fuse and keeping the loop out of main. Also note that T3's helpers (`snapShot/GlobalShiftShortcutProcess.ts`) use RunAsNode too.

## 5. Desktop as a host for remote clients (T3 only, mostly don't copy)

- **Exposure modes** (`backend/DesktopServerExposure.ts`): `local-only` binds `127.0.0.1`. The network mode binds `0.0.0.0` and advertises the first usable LAN IPv4 address, skipping loopback, link-local and Tailscale ranges. Optional Tailscale Serve lives in `tailscaleEndpointProvider.ts`. Changing exposure restarts the app (`docs/user/remote-access.md`).
- **T3 Connect** (`infra/relay`, a Cloudflare Worker deployed with Alchemy, plus PlanetScale): account linking, managed tunnels, short-lived credentials and push. It stays out of the data path.
- **CLI** `npx t3`: `apps/server/package.json` `bin: t3 → dist/bin.mjs`. Per-platform npm packages wrap a Node single-executable archive (`scripts/build-cli-archive.ts`, `build-npm-platform-packages.ts`, `install.sh`/`.ps1`). The desktop's SSH environments install the *same version* archive on a remote host (`resolveDesktopSshCliRunner` in `main.ts`).
- **Don't copy any of this.** openchat's server is already a multi-user, network-reachable instance (Docker), and 122 rules out a local server. A relay would also be hosted, paid-style infrastructure, against AGENTS.md's OSS-only rule.

## 6. Other things not to copy, and why

- **Effect `Context.Service` classes and layers everywhere.** This conflicts with openchat's D8: no DI container, no classes outside adapters, ports as function arguments.
- **Serving the client over a custom `t3code://` scheme** with a broad CSP (`connect-src http: https: ws: wss:`, `frame-src http: https:`). openchat loads the instance origin, so the server owns CSP, and the setup page already has a strict meta CSP (`src/renderer/index.html`). A custom scheme is only worth it if openchat ever bundles a renderer again.
- **A `webviewTag:true` main window** with `contextIsolation=false` guest preloads for the preview browser (`preview/WebviewPreferences.ts`). openchat refuses webviews (D24). Keep that.
- **SnapShots:** window capture behind a global shortcut, with macOS osascript polling for a modifier pair, a GNOME Shell extension over D-Bus (`apps/desktop/gnome-extension/`), Rust KDE and Hyprland helpers, and AT-SPI accessibility text. It costs a lot to maintain across desktop environments. If openchat wants "attach my screen", Electron's `desktopCapturer` on macOS is enough. The GNOME extension only exists because Wayland blocks app-driven capture.
- **The 8-second log-grep smoke test.** openchat's Playwright smoke is stronger.
- **No tray in T3.** openchat's menu-bar Quick AI (118) has no counterpart there. T3's global shortcut is used only for SnapShots, so openchat's `quick-shortcut.ts` registration, conflict reporting and `unregisterAll` are already the more complete design.

## Where each idea lands

| Ticket | Ideas |
|---|---|
| 119 | 1 (mock update server), 2 (update state machine and UI), 8 (channels and manifests) |
| 117 | 4 (transparent overlay), 5 (zoom-safe inset) |
| 116 | 3 (preload guard), 6 (notifications and badge), 7 (deep-link sign-in) |
| 120 | Section 4 only, and only if cowork is revived |

The highest value for the effort is 1, 3 and 4.
