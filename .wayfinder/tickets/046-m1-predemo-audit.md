---
id: "046"
title: "Pre-demo audit: the §11 M1 checks e2e doesn't cover"
labels: [wayfinder:task]
status: closed
assignee:
blockedBy: []
---

## Question

The e2e suite (23 tests) covers `PLAN.md` §11 M1 steps 1–5, 7, 8 and 10, and the just-bash half of 6.
Before Connor's demo (026), do the remaining §11 checks pass?

1. **Docker sandbox (step 6):** with `--profile sandbox`, an agent (mock model) runs `npm create vite` and a dev
   server, and the preview loads. `web` has no Docker socket mounted, and `sandbox-runner` reports `runsc` or the warning.
2. **Config:** an invalid `app.config.yaml` fails at boot with a readable error.
3. **Brand:** changing `brand.name` renames the app everywhere (UI title, emails/strings, metadata). The CI brand check catches a stray `openchat` literal.
4. **Icons:** switching `icons.set` to `material` and rebuilding changes the icons in shadcn primitives, AI Elements, the file tree and Markdown. CI lists unmapped icons.
5. **Contract:** `/openapi.json` from the running app passes Redocly lint.
6. **i18n:** `lingui extract` reports zero missing keys.

## Done when

Each check above has a recorded result (pass, or a fix merged, or a follow-up ticket for anything bigger than an hour).
Checks that can be automated cheaply become tests or guards. The Resolution lists what Connor can skip in the demo.

## Owns

Anything except `packages/contract` (contract changes go to Connor). Keep fixes small.

## Results (2026-09-28, loop)

Docker Desktop 29.3.1 (runc only). The compose run reused 045's images (`openchat-web`,
`t-045-sandbox-runner`) as project `t046`, with an `app.config.yaml` whose only provider is the
e2e mock model (`e2e/support/mock-llm.ts` on the host, via `host.docker.internal`), `sandbox.default:
docker` and `SANDBOX_EGRESS=open` so npm can reach the registry. Host checks used `next start`
builds of this branch. Everything I started is torn down (`down -v`, sandbox containers, volumes
and the `sandbox-egress` network).
Gate: `bun run check`, `check:guards`, `bun turbo typecheck lint test build` 79/79; the full
Playwright suite passes (24 tests, 1.1 min).

| # | Check | Result |
|---|---|---|
| 1 | Docker sandbox (step 6) | **Fails as-is**: `npm create vite` can't run, and a Vite dev server's preview is blank. Isolation checks pass. Follow-ups A and B |
| 2 | Invalid `app.config.yaml` | **Pass**, with a caveat about timing |
| 3 | Brand | **Pass**. Now an e2e test (`df85ed2`) |
| 4 | Icons | **Partial**: the build-time swap works (checked with phosphor); `material` doesn't exist and `icons.set` isn't read. CI now prints the unmapped-icons report (`c3deb4c`). Follow-ups C and D |
| 5 | `/openapi.json` passes Redocly | **Failed, fixed** (`dd6918d`): the app served no document; it now serves `/api/openapi.json` |
| 6 | `lingui extract`, zero missing | **Pass** |

### 1. Docker sandbox

- **Isolation: pass.** `web` has no `/var/run/docker.sock`, is only on the compose default network,
  and can't resolve `docker-socket-proxy` (ENOTFOUND). `sandbox-runner` logs `runtime: runc` with
  the admin warning ("Sandboxes run under plain Docker (runc) because gVisor (runsc) isn't
  installed…"), and the panel shows the *Container* isolation badge. That's expected on macOS (D7,
  decision 0005).
- **The agent runs commands: pass.** `[tool:bash …]` in a chat whose sandbox is Docker ran as uid
  1000 with Node 24.21 and npm 11.19, in `/work`.
- **`npm create vite`: fails.** `npm create -y vite@latest app -- --template vanilla
  --no-interactive` exits 126 with `sh: 1: create-vite: Permission denied`. Docker mounts tmpfs
  `noexec` by default. `$HOME` (`/home/sandbox`) and `/tmp` are tmpfs
  (`apps/sandbox-runner/src/spec.ts`, `buildContainerSpec`), and `npx` runs a package's bin from
  `~/.npm/_npx`. With `npm_config_cache=/work/.npm-cache` (the cache moved into the executable
  workspace volume), scaffolding and `npm install` took 9 s.
- **Dev server and proxy: pass.** `./node_modules/.bin/vite --host 0.0.0.0 --port 5173`, started in
  the background from `bash`, stays up. `[tool:preview {"port": 5173}]` returns
  `http://<id>-5173.sandbox.localhost:7071`, and the runner's proxy answers it with Vite's
  `index.html` (200).
- **The preview in the panel: blank.** The preview iframe has `sandbox="allow-scripts allow-forms
  allow-popups allow-modals"` and no `allow-same-origin`, so the page's origin is `null`. Vite
  (6.0.9 and later) refuses cross-origin module scripts by default, so `/@vite/client` and
  `/src/main.js` are "blocked by CORS policy" and nothing renders. I checked this with headless
  Chromium and the same iframe attributes. With `vite --cors` the app renders in that iframe, with
  two gaps: SVG `<use href="/icons.svg#…">` is refused from the opaque origin, and the HMR
  WebSocket fails, because the preview proxy doesn't pass the upgrade through. A plain Node
  server, like the one in 045's smoke test, has none of these problems.
- **The Claude app's built-in browser can't show previews.** It blocks
  `*.sandbox.localhost` (`net::ERR_BLOCKED_BY_CLIENT`). Demo the preview in Chrome.
- **Found and fixed (`3f686fb`):** a sandbox panel restored open on reload said "This chat has no
  sandbox yet" for a chat that had one. `useState(initial)` ignored the chat's sandbox query when
  it answered after the panel had mounted. The panel now adopts a sandbox, or a preview the agent
  exposed, that arrives later. The chat also refetches its sandbox after every run, so the header
  pill (which said "No sandbox" until a reload) and the Preview tab pick up what the agent did.
  This is covered by `use-sandbox-panel.test.ts` and a reload step in `e2e/tests/sandbox.spec.ts`.
  I checked that the reload step fails without the fix.
- Not looked into: the chat's Markdown shows the preview URL in the tool output as `[blocked]`
  (an `http:` link).

### 2. Config

Pass. I gave the Docker `web` container a file with a bad enum, a bad URL, `sandbox.default: docker`
without a `docker:` block, and an unknown top-level key.

- The log shows `[config] app.config.yaml is invalid:` followed by one line per problem, by path
  (`app.config.yaml  auth.signup: Invalid option: expected one of "open"|"invite"|"domain"|"sso"`).
- Every `/api` request answers 500 with the same list.
- Signed-in pages say "This server isn't set up correctly".
- The healthcheck fails, so the container never becomes healthy and `compose up --wait` fails.

Caveat: `web` boots on its first request (by design since 025, so `next build` never opens a
database). So the error appears when the first request arrives: about 10 s under Docker (the
healthcheck), and not until someone visits under a bare `next start`. Schema errors carry no line
number (only YAML syntax errors do). Cross-field checks, such as a `models.default` pointing at a
missing provider, only run once the rest of the schema passes. `packages/config` tests cover the
parsing and the messages. Optional small follow-up: validate the config in `instrumentation.ts`
`register()` so a bare `next start` logs the problems at start.

### 3. Brand

Pass. With `brand.name: Audit Chat`, the tab title, the sidebar and the sign-in page all showed it.
Every page takes the root layout's title, and nothing sets its own. M1 sends no email (there's no
mailer), so there's nothing to rename there. The MCP client name reads `brand.name` too.

The CI brand check works: a probe file containing the codename makes `bun scripts/ci/cli.ts brand`
exit 1 with `path:line:col` (the probe is deleted). CI runs it in the "Repo guards" step, and it has
fixture tests.

New e2e test `shell.spec.ts` "the name comes from config" (`df85ed2`) checks the title on three
signed-in pages, the sidebar, and the sign-in page against `serve.ts`'s `brand.name`.

### 4. Icons

- **The build-time swap works.** I built with `ICON_SET=phosphor bun turbo build --filter web` and
  signed in to that build. Every SVG in the document is Phosphor: 41 have a `0 0 256 256`
  viewBox, and none have lucide's `0 0 24 24`. That covers the sidebar and buttons (shadcn), the
  message actions (AI Elements), the Streamdown code block's copy and download buttons
  (Markdown), and the file tree's six sprite symbols (in its shadow root).
- **`icons.set: material` does nothing.** There's no Material set: `bun run icons:gaps` shows all
  103 names falling back to lucide, and the icons README says "not yet". `icons.set` in
  `app.config.yaml` isn't read either: `ICON_SET` picks the set, and
  `packages/icons/scripts/select.ts` still says it "stands in until packages/config lands".
- **Lucide stays in the bundle.** Under Phosphor, lucide's glyph data for names Phosphor draws
  (`chevron-down`, `copy`, …) is still in three client chunks, because the lucide fallback set
  isn't tree-shaken. D19 says the other sets never reach the bundle.
- **"CI lists unmapped icons":** `icons:gaps` existed, but nothing ran it. The `ci` job now
  runs it after the guards (`c3deb4c`). It's a report, not a gate. Today Phosphor web falls back
  for 9 names (PanelRight, OctagonX, History, KeyRound, Languages, Mail, Network, Palette,
  Wallet). Phosphor native, Tabler, Hugeicons and Material aren't implemented.

### 5. Contract

The running app served no OpenAPI document (404 at `/openapi.json` and `/api/openapi.json`).
`dd6918d` adds a public `GET /api/openapi.json`, generated from the contract on its first
request. Against `next start` of this branch it answers 200. The document is identical to the
committed `packages/contract/openapi.json` (83 paths), and `redocly lint` with the contract's
`redocly.yaml` says it's valid. `packages/server/src/app.test.ts` checks that the served document
equals the committed file. `lint:openapi` lints the committed file, and the contract tests keep
it current. The path is under `/api`, like the document's `servers` URL. If the docs site wants
`/openapi.json` at the root, that's a one-line rewrite.

### 6. i18n

Pass. `lingui extract --clean` finds 823 messages and leaves the catalog unchanged. The `lingui`
guard (CI "Repo guards") is green: no missing translations and no obsolete keys.

### Follow-ups (each more than about an hour, or Connor's call)

- **A. The sandbox's `$HOME` and `/tmp` are `noexec`** (Connor's call; it's a hardening change).
  `npx`, and with it `npm create …`, fails in every Docker sandbox. The smallest fix is `exec` in
  the two tmpfs option strings in `apps/sandbox-runner/src/spec.ts` (and `spec.test.ts`), since
  the `/work` volume is executable anyway. The session's permission check blocked me from making
  that edit because it loosens hardening, so it's yours to decide. The other route is
  `NPM_CONFIG_CACHE=/work/.npm` in the container env (it puts npm's cache in the workspace and
  its snapshots).
- **B. Vite dev previews are blank** (D24 decision, then about half a day). The preview iframe's
  opaque origin fails Vite's CORS default. The options are: `allow-same-origin` when the preview
  origin is on a different site from the app (it isn't, on `localhost`); the preview proxy
  answering `Access-Control-Allow-Origin` for `null`; or telling the agent to run dev servers
  with CORS on (`vite --cors`). Separately, the preview proxy should pass WebSocket upgrades
  through so HMR works.
- **C. Material Symbols set, and `icons.set` from config** (D19, about a day). Generate
  `src/sets/material.ts` from `@material-symbols/svg-*` (Apache-2.0), honouring
  style/weight/fill. Make `icons:select` read `icons.set` from `app.config.yaml` (`CONFIG_PATH`),
  and key turbo's cache on it. Decide how a Docker image, built before its config is mounted, gets
  its set (a build arg is the likely answer).
- **D. Keep lucide out of the bundle under another set** (small). Tree-shake the lucide fallback
  so only the names a set lacks are bundled.

### What Connor can skip in the demo (026)

- **Skip:** step 9 (i18n); the whole Config and brand block (invalid config, `brand.name`, the
  brand check); Contract's `/openapi.json` + Redocly; and in step 6, "`web` has no Docker socket
  mounted, and `sandbox-runner` reports `runsc` or a warning" (runc and the warning, as expected
  on a Mac). Steps 1–5, 7, 8 and 10 and the just-bash half of 6 are covered by e2e. That now
  includes a reload of the sandbox panel and the brand name.
- **Icons:** "CI lists unmapped icons" is done. The swap mechanism is shown with `ICON_SET=phosphor`.
  The literal check (`icons.set: material`) can't pass until follow-up C, so skip it or show
  Phosphor instead.
- **Still to demo, after deciding A and B:** the Docker leg of step 6. Until those land, it only
  works with workarounds: have the agent run
  `npm_config_cache=/work/.npm-cache npm create vite@latest app -- --template vanilla
  --no-interactive`, then `vite --host 0.0.0.0 --cors`, and open the app in Chrome, not the Claude
  app's built-in browser. The compose `web` image also predates this branch, so rebuild it to get
  `/api/openapi.json` and the panel fix.

## Resolution (2026-09-28, loop)

Merged in [PR #37](https://github.com/connorwforsyth/openchat/pull/37). Config, brand, i18n pass; `/api/openapi.json` added; sandbox panel reload fixed; CI prints `icons:gaps`. Follow-ups: A+B are Connor's ([047](047-sandbox-dev-previews.md), then [050](050-sandbox-dev-previews-build.md)); C+D are [048](048-material-icons.md); WebSocket upgrades are [049](049-preview-websockets.md).
