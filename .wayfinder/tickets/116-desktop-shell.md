---
id: "116"
title: "Desktop shell: an electron-vite app that runs the chat against a server"
labels: [wayfinder:build]
status: open
assignee: loop
blockedBy: []
---

## Question

Desktop wave (`PLAN.md` §2 Desktop, D7 cowork, D14 Quick AI and title bar, D24 IPC rules, D28 desktop renderer). Connor said "keen to start desktop" (2026-10-02); the loop treats it as M1 sign-off for planning — he confirms in 122.

The first usable desktop app: the same chat, settings and library as the web, in a native window, against an instance the person signs in to. No cowork yet.

## Done when

- `apps/desktop` (electron-vite: main, preload, renderer). The renderer is a Vite React app sharing `packages/{ui,chat-ui,composer,client,shortcuts,i18n}` as PLAN says (a second shadcn app). Any app glue that lives only in `apps/web` (chat route, app frame) is first moved into a shared package so both apps use it, with web unchanged.
- **Server:** instance URL only (Connor, 2026-10-02). The person enters it on first run; it's remembered and switchable. macOS first. Sign-in through the system browser with PKCE (`@better-auth/electron`); no passwords typed into the app.
- **Security (D24):** `contextIsolation`, no `nodeIntegration`, a strict preload with zod-parsed IPC, and navigation and new windows locked to the instance and the artifacts origin.
- Streaming and resume work (the run stream over fetch). Lingui works.
- Playwright `_electron.launch` smoke test: launch, sign in against the e2e server, send, get a reply. Gate passes; `bun run desktop:dev` documented.

## Owns

`apps/desktop/**` (new), shared app-glue moves out of `apps/web` (web unchanged), `e2e/desktop/**`.

## Design change (2026-10-02, coordinator)

Because 122 settled on **instance URL only**, the shell loads the instance's
own web app in a `BrowserWindow` instead of re-implementing it in a Vite
renderer that shares `packages/*` (PLAN.md §2 Desktop, D28's "desktop
renderer"). Chat, settings, the library, streaming and resume, Lingui and the
theme come with the web app and stay in step with the server's version. The
only local renderer is a first-run screen that asks for the instance URL. No
app glue moves out of `apps/web`. Sign-in is the web app's own inside the
window; the system-browser PKCE flow (`@better-auth/electron`) is deferred
until OAuth/SSO providers need it. Recorded in `apps/desktop/README.md`.

## Results (2026-10-02, loop)

- `apps/desktop` (electron-vite 6 beta on Vite 8, Electron 44): main,
  two sandboxed preloads (`instance`, `setup`) and the first-run page
  (React + `@workspace/ui`, Lingui). The URL is checked against the
  instance's `GET /api/config` (brand only, so version skew passes), stored
  in `userData/settings.json`, and switchable from **Change Server…** in the
  app menu. `DESKTOP_INSTANCE_URL` connects for one run without saving;
  `DESKTOP_USER_DATA` moves settings and the session.
- D24: `contextIsolation`, `sandbox` (+ `app.enableSandbox()`), no
  `nodeIntegration`, no `webviewTag` (`will-attach-webview` refused);
  top-level navigation, redirects and `window.open` held to the instance
  origin, other http(s)/mailto to the system browser, other schemes dropped;
  permissions deny-by-default (clipboard write and fullscreen for the
  instance only; no devices); http only for loopback; zod-parsed IPC on both
  sides, setup calls accepted only from the setup window's main frame.
- The web app can tell it's in the shell: `window.desktop` (`platform`,
  `onMenuCommand`) and a `DesktopShell/<version>` user-agent token. Web
  behaviour unchanged (no `apps/web` edits).
- Scripts: `bun run desktop:dev`, `bun run desktop:build` (unpacked, to
  `apps/desktop/dist`), `bun turbo test:desktop` (its own task, macOS only via
  `e2e/desktop/run.ts`).
- Smoke test `e2e/desktop/smoke.spec.ts` (`_electron.launch`, e2e server on
  3190): first-run screen (refuses remote http, then connects), the web
  app's sign-in as a seeded user, a sent message and the mock's streamed
  reply, the bridge's shape, the UA token, external links to a stubbed
  `shell.openExternal`, a `file:` navigation dropped, geolocation denied.
  Passes (~7 s, plus building web).
- Gate: 89/89 tasks, `evals --strict: ok`. Unit tests for the pure core.
- Web e2e (queue, port 3282): 73 passed, 1 failed: `composer.spec.ts`
  "the thinking level and fast mode sit apart" (105), where the Fast mode
  chip stays visible after switching to parrot. It fails the same way when
  run alone. This branch changes nothing in `apps/web` or the composer (only
  new catalog entries), so it predates 116; flagged for whoever owns 105/114.
- Build output is minified and comment-free so `lingui extract` (which scans
  `apps/`, built output included) doesn't pick up the bundles.

Open for 117–119: the dev app is "Electron" in the menu bar and keeps
userData under `desktop` until 119 sets the brand's name and app ID;
`onMenuCommand` has its channel and schema but no sender yet (117); the
artifacts origin isn't in the public config, so `window.open` to it goes to
the system browser (a contract field would let the shell allow it);
OAuth/SSO sign-in needs the PKCE system-browser flow; 119 should add
Electron fuses (no `ELECTRON_RUN_AS_NODE`, ASAR integrity).
