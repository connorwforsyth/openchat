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
(`platform`, `onMenuCommand`, `hideQuickAi`) and a `DesktopShell/<version>`
token at the end of the user agent. The web app reads the bridge through
`@workspace/shortcuts/desktop` (`useDesktopPlatform`, `onDesktopMenuCommand`);
in a browser there's no bridge and nothing changes.

## Native chrome (117)

- **Menus from the shortcut registry.** `src/main/menu.ts` places registry
  ids in the File, View, Chat and Help menus (and the app menu on macOS).
  Labels are the registry's descriptions, accelerators come from
  `@workspace/shortcuts/electron`, and a click sends the id to the page over
  `desktop:menu-command`. On the page, `useShortcut` (and the chat screen's
  own `useShortcuts`) run the same handler as the keys, so every bound
  shortcut works from the menu with no extra wiring. The page sees a key
  press first and claims the ones it handles, so nothing runs twice.
  Single-key shortcuts (N, J, /) get no accelerator, since it would fire
  while typing; their items work by click. `OFF_MENU` lists the shortcuts
  with no item and why (stop and copy-last-reply: the web app doesn't bind
  them yet), and a test keeps every registry id in a menu or in that list.
- **Title bar (macOS).** The main window is `titleBarStyle: 'hiddenInset'`
  with the traffic lights centred in the 48px header. The web app's header
  (and the sidebar's top row while the sidebar is docked) is the drag region,
  with `no-drag` on its controls, and leaves 80px for the lights. Sign-in
  pages get a drag strip along the top. Windows and Linux keep the native
  frame for now (122: macOS first), so the page lays out as on the web.
- **Window state.** The main window's bounds and maximised state are saved
  to `settings.json` half a second after a move or resize, and on close. A
  saved spot whose top strip is no longer on any display is dropped (the
  size is kept), so an unplugged monitor never strands the window.
- **Not yet:** the menu shows the registry's default keys, not a person's
  recorded overrides (those live in the web app's settings).

## Quick AI and the menu bar icon (118)

- **Quick AI** is a small floating window (frameless, always on top, a
  panel over full-screen apps on macOS), centred on the display under the
  pointer. It shows the instance's own `/quick` page: the composer alone,
  in the same signed-in session. **⏎** starts a new chat and shows the
  streaming reply in the window; **⌘⏎** starts it and opens the chat in the
  main window once the run exists, where the reply carries on. **Escape**
  or clicking elsewhere hides it; a reply keeps streaming while it's hidden.
  The window's height follows the page (Electron's preferred-size mode),
  between the composer alone and 560px.
- **Opening it:** a global shortcut, **Quick AI** in the app menu (File
  menu off macOS) and the menu bar icon. The shortcut is ⌥Space unless
  `settings.json` says otherwise, in the web app's notation
  (`"quickAi": { "shortcut": "Mod+Shift+Space" }`, `null` for none), or
  **Quick AI Shortcut** in the menu picks one of a few. A shortcut another
  app holds, or one that would swallow a key (no ⌘, Ctrl or ⌥), is
  reported in a dialog and Quick AI stays on the menus. Every global
  shortcut is released on quit.
- **Locks:** the main window's (D24), plus one: the Quick AI window stays
  on `/quick`. The rest of the instance (a chat after ⌘⏎, sign-in when the
  session has gone) opens in the main window, and the Quick AI window loads
  `/quick` afresh next time. `hideQuickAi` on the bridge is honoured only
  from the Quick AI window's own page.
- **Menu bar icon (macOS):** New chat, Quick AI, Show Window, Quit. Its
  icon is a template image made from the brand's logo (119, below); the
  speech bubble drawn in `src/main/tray-icon.ts` is the fallback when
  there's none.

## Brand, packaging and updates (119)

- **Brand.** The app's name, app ID, URL scheme and icon come from the
  `brand:` block of `app.config.yaml` (`scripts/brand.ts`), with fallbacks
  (`local.<name>.desktop`, no scheme, a neutral placeholder icon).
  `bun run brand` (before every build and dev run) writes `.brand/`: the
  icons (`.icns`, `.ico`, PNGs, the menu bar's template image, all rendered
  from the logo with resvg) and `build.json`, which electron-vite writes
  into main as `__DESKTOP_BUILD__` (`src/main/build-info.ts`). Main sets
  the app's name and its userData folder from it, so a dev run is named
  like the packaged app (settings move from `…/desktop` to `…/<name>`).
  macOS's bold menu bar title in a dev run is still the Electron bundle's.
- **Packaging** (`scripts/package.ts`, config in
  `scripts/builder-config.ts`): electron-builder, with only the bundles
  staged into `app.asar`. macOS dmg + zip (arm64 and x64), Windows NSIS,
  Linux AppImage. Fuses: no `RunAsNode`, `NODE_OPTIONS` or `--inspect`;
  ASAR integrity checked and the app loaded only from it. Unsigned, re-signed
  ad hoc on Apple Silicon; signing turns on with `CSC_*` variables.
- **Auto-update** (`src/main/updates.ts`): electron-updater from GitHub
  Releases, off unless packaged with `DESKTOP_AUTO_UPDATE=1` and
  `DESKTOP_UPDATE_REPO`; off, the updater module is never loaded.

## Security (`PLAN.md` D24)

- Every window, Quick AI's too: `contextIsolation`, `sandbox` (and
  `app.enableSandbox()`), no `nodeIntegration`, no `webviewTag` (and
  `will-attach-webview` is refused), `navigateOnDragDrop: false`,
  `safeDialogs`.
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
  directory (tests, or two copies side by side). `DESKTOP_TEST_HOOKS=1` is
  for the smoke test only.
- A run registers the Quick AI shortcut (⌥Space by default). To keep a dev
  run off it, set `"quickAi": { "shortcut": null }` in that run's
  `settings.json`.
- `bun run desktop:build` writes the three bundles to `dist/` (main and the
  preloads bundle their dependencies; workspace packages are TypeScript
  source). Run the result with `bunx electron apps/desktop`.
- `bun run desktop:package` makes an unsigned app and installers for this
  machine in `release/`; `bun run package:smoke` (in this folder) launches
  the result and quits it. See below and `docs/desktop.md`.
- The Electron binary downloads on first use (Electron 44 fetches it
  lazily, into `node_modules/electron/dist`).

## Tests

- `bun turbo test --filter=desktop`: the pure core in Node (URL parsing,
  navigation and permission rules, settings, the instance check, the menus
  from the registry, window placement; for 118 the Quick AI shortcut's
  parsing and registration, its window's placement and height, its
  navigation rule, the tray menu and icon; for 119 the brand's reading and
  fallbacks, the electron-builder config and signing switches, the PNG, ICO
  and ICNS writers, the menu bar template from a logo, and the update rule).
- `bun turbo test:desktop`: `e2e/desktop/smoke.spec.ts`, a separate task
  (not part of `test` or `test:e2e`). It builds `apps/web` and this app,
  starts the e2e server (`e2e/support/serve.ts`) on port 3190
  (`E2E_DESKTOP_PORT`), launches the built app with Playwright's
  `_electron.launch` and goes through the first-run screen, the web app's
  sign-in as a seeded user, a chat with the mock model's reply, the
  navigation and permission locks, and (117) the title bar's drag regions,
  menu commands reaching the web app (sidebar, palette, new chat) and the
  window's bounds being saved; and (118) Quick AI opened from the menu bar
  icon and the app menu (a global shortcut can't be pressed in a test): a
  reply in the window, Escape, ⌘⏎ handing the chat to the main window, the
  shortcut registered from `settings.json`, reported when taken, changed
  from the menu and released on quit. It sets an unused shortcut
  (⌃⌥⇧F12), so it never takes a key from the person at the machine. `e2e/desktop/run.ts` skips it, passing,
  off macOS or without the electron package. A window opens on screen while
  it runs.
