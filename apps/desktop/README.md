# desktop

The desktop shell (ticket 116): an Electron app, built with electron-vite,
that shows an instance's own web app in a native window. macOS first;
Windows and Linux follow (ticket 122).

## How it works

**Instance URL only (122).** The first run asks for the server's address
(the one you use in the browser), checks it by reading its public config
(`GET /api/config`) and remembers it in the app's `userData`
(`settings.json`). The main window then loads that origin. **Change
Server…** in the app menu (File menu off macOS) switches it.

This deviates from `PLAN.md`'s "Vite renderer sharing `packages/*`": with
the server always remote, the shell loads the server's web app instead of
rebuilding it in a second renderer. Chat, settings, the library, streaming
and resume, Lingui and the theme come with it and stay in step with the
server's version for free. The only local page is the first-run screen
(`src/renderer`, React with `@workspace/ui`).

```
src/
  main/       Electron main: windows, IPC handlers, menu, settings, the instance check
  preload/    instance.ts (the server's pages), setup.ts (the first-run page)
  renderer/   the first-run screen
  shared/     pure rules: instance URLs, navigation and permissions, IPC schemas
```

**Sign-in** is the web app's own, inside the window. Its cookies live in the
persistent `persist:instance` session partition, so a restart stays signed
in. OAuth and SSO providers redirect to another origin, which the shell
sends to the system browser, so they don't complete in the app yet: that
needs the system-browser PKCE flow (`@better-auth/electron`), a follow-up.

**Knowing it's in the shell.** The server's pages get `window.desktop`
(`platform`, `onMenuCommand`) and a `DesktopShell/<version>` token at the end
of the user agent. The web app doesn't use either yet; 117 adapts the title
bar.

## Security (`PLAN.md` D24)

- Every window: `contextIsolation`, `sandbox` (and `app.enableSandbox()`),
  no `nodeIntegration`, no `webviewTag` (and `will-attach-webview` is
  refused), `navigateOnDragDrop: false`, `safeDialogs`.
- Top-level navigation stays on the instance's origin. `window.open` to the
  instance loads in the main window; other `http(s)` and `mailto` links open
  in the system browser (`shell.openExternal`); every other scheme is
  dropped. The same goes for server redirects. Artifact and preview iframes
  are subframes: the web app sandboxes them and they never get the bridge.
- Permissions are denied by default. The instance may write to the
  clipboard and go fullscreen; camera, microphone, location, notifications,
  devices and the rest are refused until a feature needs one.
- Plain `http://` is accepted only for loopback servers; anything else must
  be `https://`, so the session cookie never travels in the clear.
- The preloads expose only what's listed above. Every IPC payload is
  zod-parsed on both sides (`src/shared/ipc.ts`), and main answers setup
  calls only from the setup window's own frame. Nothing reaches the
  filesystem or a shell.

## Running it

```sh
bun run desktop:dev                                   # first-run screen
DESKTOP_INSTANCE_URL=http://localhost:3000 bun run desktop:dev   # straight to a server
bun run desktop:build                                 # unpacked build in apps/desktop/dist
bun turbo test:desktop                                # the Electron smoke test (macOS)
```

- `DESKTOP_INSTANCE_URL` connects to that server for one run without saving
  it. `DESKTOP_USER_DATA` keeps settings and the session in another
  directory (tests, or two copies side by side).
- `bun run desktop:build` writes the three bundles to `dist/` (main and the
  preloads bundle their dependencies; workspace packages are TypeScript
  source). Run the result with `bunx electron apps/desktop`. Packaging,
  icons, the brand's app name and signing are ticket 119; until then the dev
  app is called "Electron" in the menu bar.
- The Electron binary downloads on first use (Electron 44 fetches it
  lazily, into `node_modules/electron/dist`).

## Tests

- `bun turbo test --filter=desktop`: the pure core in Node (URL parsing,
  navigation and permission rules, settings, the instance check, the menu).
- `bun turbo test:desktop`: `e2e/desktop/smoke.spec.ts`, a separate task
  (not part of `test` or `test:e2e`). It builds `apps/web` and this app,
  starts the e2e server (`e2e/support/serve.ts`) on port 3190
  (`E2E_DESKTOP_PORT`), launches the built app with Playwright's
  `_electron.launch` and goes through the first-run screen, the web app's
  sign-in as a seeded user, a chat with the mock model's reply, and the
  navigation and permission locks. `e2e/desktop/run.ts` skips it, passing,
  off macOS or without the electron package. A window opens on screen while
  it runs.
