---
id: "050"
title: "Build 047's choices: npm create in sandboxes, and non-blank dev previews"
labels: [wayfinder:build]
status: closed
assignee:
blockedBy: ["047", "049"]
---

## Question

Implement what Connor picks in [047](047-sandbox-dev-previews.md).

## Done when

With compose `--profile sandbox` and the mock model, an agent runs `npm create vite` and a dev server,
and the preview renders in the chat's panel (PLAN.md §11 M1 step 6). The sandbox smoke covers it.

## Owns

`apps/sandbox-runner/**`, `packages/sandbox/**`, `packages/chat-ui/src/sandbox/**`.

## Results (2026-09-28, loop)

Built both of Connor's choices from [047](047-sandbox-dev-previews.md). While checking the panel I found and fixed a third problem: a preview the agent started never reached the panel.

- **Exec in `$HOME` and `/tmp`** (`3388b14`). Docker mounts tmpfs `noexec` unless told otherwise, so the two
  option strings in `apps/sandbox-runner/src/spec.ts` now say `exec`. `nosuid`, `nodev`, the size caps
  and every other hardening option are unchanged. `spec.test.ts` pins both option strings.
- **The preview proxy allows the null origin** (`3388b14`). `previewCors` in `apps/sandbox-runner/src/app.ts`:
  for a request with `Origin: null` the response gets `Access-Control-Allow-Origin: null`, and any
  `Access-Control-Allow-Credentials` from the dev server is dropped. Every proxied response gets
  `Vary: Origin` (appended; left alone when `Vary` already covers it). Any other origin gets exactly
  the dev server's headers. The iframe's sandbox attributes are unchanged. `app.test.ts` covers the null
  origin, dropping credentials, and other origins (none, the app's, a stranger's, and one the dev server
  allows itself) left as the dev server answered.
- **Found and fixed (`9be7ef6`): the agent's `preview` tool never reached the panel.** The panel shows the
  previews on the chat's sandbox row. The panel's own Preview button recorded them there, but the
  agent's tool called the provider directly, so the Preview tab stayed empty, even after a reload. The
  turn's sandbox (`packages/sandbox/src/handlers/turn-tools.ts`) now records what it exposes through the
  same `recordPreview` as the panel's button. A new `turn-tools.test.ts` case covers it, and I checked
  that it fails without the fix.

### Verification

Gate: `gate.sh` passes (check, guards, `turbo typecheck lint test build` 79/79).

- **Unit tests:** `sandbox-runner` 40/40 and the `sandbox` handler tests pass.
- **Sandbox smoke** (`apps/sandbox-runner/test/e2e/smoke.ts`, compose `--profile sandbox`, runc): passes.
  New steps:
  - `npm create` and `npx` against a registry the smoke runs on the sandbox's loopback. CI's egress is
    `none`, so the registry makes this work offline, and it takes npm's real route through
    `~/.npm/_npx`.
  - A binary run from `/tmp`.
  - A module script fetched through the preview URL with `Origin: null`. It must come back with
    `Access-Control-Allow-Origin: null` and no credentials header. A stranger's origin must get no
    `Access-Control-Allow-Origin`.

  With the old `spec.ts` the smoke fails at `npm create` (`sh -c 'create-smoke'`, exit 126). With the
  old `app.ts` it fails at the module script.
- **End to end, in the panel (§11 M1 step 6, Docker leg):** I ran the runner (compose project `t050`,
  `SANDBOX_EGRESS=open`) and `next start` of this branch with `sandbox.default: docker` and the e2e mock
  model. Then a headless Playwright script (under `scripts/ci/browser-lock.ts`), as a new user:
  1. Created the chat's sandbox from the panel.
  2. `[tool:bash …]`: `npm create -y vite@latest app -- --template vanilla --no-interactive && npm install`
     took 12 s.
  3. `[tool:bash …]`: started `vite --host 0.0.0.0 --port 5173` (Vite 8.3.1).
  4. `[tool:preview {"port": 5173}]`.

  The Preview tab picked up the agent's preview without a reload. The iframe
  (`sandbox="allow-scripts allow-forms allow-popups allow-modals"`) rendered Vite's page ("Get started",
  "Count is 0"). An edit to `src/main.js` from the agent then showed up in the iframe over HMR (049's
  WebSocket proxy).
- **Gap left (not CORS):** the Vite template's `<svg><use href="/icons.svg#…">` icons don't draw. Chromium
  refuses an SVG `<use>` of an external file from an opaque origin ("Domains, protocols and ports must
  match"), and no response header changes that. Only those small icons are affected. Fixing it would
  need `allow-same-origin` on a different site, which 047 ruled out.
- Everything I started is torn down: compose `t050` `down -v`, the `sbx-*` containers, volumes and
  networks, `sandbox-egress`, and the web server (stopped by PID).

## Resolution (2026-09-28, loop)

Merged in [PR #41](https://github.com/connorwforsyth/openchat/pull/41). Exec in `$HOME` and `/tmp`, null-origin CORS on the preview proxy (no credentials), and the agent's previews now reach the panel. The smoke covers npm create, exec in /tmp and a null-origin module script. Verified end to end in headless Chromium: Vite renders in the panel and hot reload works. Gate 79/79. Known gap: SVG `<use>` sprites don't draw from an opaque origin (browser rule).
