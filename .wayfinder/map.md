---
id: "000"
title: "openchat — a self-hosted, multi-user AI chat platform"
labels: [wayfinder:map]
status: open
---

## Destination

Everything in [`PLAN.md`](../PLAN.md) is built and verified. That means Milestone 1
(the ambitious web daily driver), then the Desktop, Collaboration & always-on,
Agents+, Annotate, Mobile & Swift, and open-source-readiness waves. Each one
passes its `PLAN.md` §11 checks at a demo gate that Connor runs.

## Notes

**This map carries execution.** Wayfinder's default is decisions only; this
effort overrides that. `PLAN.md` is the spec; the map indexes it and never
restates it. Build tickets are worked by the loop in [`LOOP.md`](LOOP.md), with
up to 3 agents in parallel, each in its own git worktree, one PR per ticket,
merged by the loop once CI passes. The repo is private on GitHub's free plan, so
there's no branch protection or auto-merge.

**Skills each session should consult:** `grilling` for every HITL ticket;
`prototype` for the UI prototype tickets; `shadcn` and `migrate-radix-to-base`
for UI; `vercel-react-best-practices` for anything in `apps/web`; `ultracite`
for lint and format. For anything in `apps/web`, read
`node_modules/next/dist/docs`: Next 16 is not the Next you know.

**Standing constraints** (from `PLAN.md` D8, D18, D19 and the design review):
- Zod-first types; `Result` errors; no classes outside adapters; no DI container.
- Semantic design tokens only; icons only via `@workspace/icons`; every
  user-facing string via Lingui macros.
- No `openchat` literal outside the brand block, the root `package.json`, image
  names, `PLAN.md` and this tracker. The config file is `app.config.yaml`.
- The app boots with an empty `.env`. Agent features work with no keys: tests use
  `MockLanguageModelV4`, and local runs use Ollama if it's present. Degrade, never crash.
- OSS only. Never spend money, create paid resources or print secrets.
- Private repo (`connorwforsyth/openchat`). Never push directly to `main`, never
  force-push, never commit `node_modules`, `.next`, `.turbo` or `.env*`.

**Ownership register.** Parallel tickets must not overlap on these paths. Each
open build ticket's **Owns** section is authoritative; this summarises it:

| Ticket | Owns |
|---|---|
| 002 scaffold | repo root config, `apps/web` skeleton, `packages/ui`, `packages/typescript-config`, `.github/`, `docker-compose.yml` |
| 003 risk checks | `docs/decisions/`, `.context/research/`, throwaway spikes under `spikes/` |
| 004 conventions | `AGENTS.md`, `CLAUDE.md`, `scripts/ci/`, lint config additions |
| 005 contracts | `packages/contract`, `packages/config`, `packages/shared`, port files in `packages/{ai,sandbox,server}/src/ports/` |
| 006 i18n + icons | `packages/i18n`, `packages/icons` |
| 007 AI Elements | `packages/ui/src/components/ai-elements/`, `.agents/skills/` or `.claude/skills/` for pierre |
| 011–025 | see each ticket |

**Tracker:** local-markdown (`.wayfinder/`). Frontier: `bun .wayfinder/frontier.ts`.
No `research` or `domain-modeling` skill is installed on this machine, so
research tickets are resolved by general-purpose sub-agents against a written
brief, and their findings land in `.context/research/`.

## Decisions so far

- [Design review of plan v1](tickets/001-design-review.md): 40 answers
  settling audience, scope (an ambitious web M1, then waves), runs, tenancy, sharing,
  config, icons, memory, evals and safety. The detail lives in `PLAN.md` §13.
- [App shell](tickets/009-prototype-app-shell.md): Classic sidebar and header, plus Workspace's right-hand Sandbox/Artifacts panel and single-key shortcuts.
- [Agent Builder and libraries](tickets/010-prototype-agent-builder.md): same shell; form + live test chat, draft/published, library tabs.
- [Contract review](tickets/008-contract-review.md): contracts accepted as built; UUIDv7 ids, separate tool parts, `/api/llm` added now, events SSE in its wave.

## Built

- [Phase 0 risk checks](tickets/003-risk-checks.md): all six usable; gVisor is Linux-only, so macOS sandboxes fall back to hardened runc ([PR #4](https://github.com/connorwforsyth/openchat/pull/4))

<!-- one line per closed build ticket: what, where, how verified -->

- [Scaffold the monorepo](tickets/002-scaffold.md): bun + Turbo + shadcn (Base UI) monorepo, Ultracite, Vitest, Playwright config, CI, compose ([PR #1](https://github.com/connorwforsyth/openchat/pull/1))
- [AGENTS.md conventions and CI guards](tickets/004-conventions.md): agent conventions + token, icon-import, brand and Lingui guards in CI ([PR #2](https://github.com/connorwforsyth/openchat/pull/2))
- [i18n and icon packages](tickets/006-i18n-icons.md): Lingui 6 with macros on Next 16, swappable icon registry with codemod ([PR #3](https://github.com/connorwforsyth/openchat/pull/3))
- [AI Elements on Base UI](tickets/007-ai-elements.md): message, reasoning, tool, prompt-input migrated; no Radix left ([PR #5](https://github.com/connorwforsyth/openchat/pull/5))
- [Contracts and ports](tickets/005-contracts.md): zod + oRPC contract, OpenAPI, config schema, ports with fakes ([PR #6](https://github.com/connorwforsyth/openchat/pull/6))
- [Contract: the /api/llm proxy](tickets/027-contract-llm-proxy.md): model proxy for the desktop loop in the AI SDK's gateway shape ([PR #7](https://github.com/connorwforsyth/openchat/pull/7))
- [WS-db](tickets/011-ws-db.md): Drizzle schema for all M1 tables, query modules, PGlite harness, Postgres 17 CI job ([PR #8](https://github.com/connorwforsyth/openchat/pull/8))
- [WS-code-ui](tickets/020-ws-code-ui.md): file tree, code and diff views on @pierre, token-themed, per-hunk review ([PR #10](https://github.com/connorwforsyth/openchat/pull/10))
- [WS-composer](tickets/016-ws-composer.md): TipTap composer with a server-rendered shell and lazy editor ([PR #9](https://github.com/connorwforsyth/openchat/pull/9))
- [WS-auth](tickets/012-ws-auth.md): Better Auth with personal orgs, sign-up policies, team-tree grants and access checks ([PR #12](https://github.com/connorwforsyth/openchat/pull/12))
- [WS-runs](tickets/014-ws-runs.md): server app, runs with resumable SSE, per-branch queue, approvals, pg-boss jobs, typed client with optimistic send ([PR #16](https://github.com/connorwforsyth/openchat/pull/16))
- [WS-mcp](tickets/018-ws-mcp.md): MCP connection manager with OAuth and sealed tokens ([PR #14](https://github.com/connorwforsyth/openchat/pull/14))
- [WS-knowledge](tickets/021-ws-knowledge.md): storage, RAG ingestion + `file_search`, chat search, web search ([PR #15](https://github.com/connorwforsyth/openchat/pull/15))
- [Millisecond timestamps](tickets/028-timestamp-precision.md): keyset cursors fixed on real Postgres; CI-safe test timeouts ([PR #18](https://github.com/connorwforsyth/openchat/pull/18))
- [WS-sandbox](tickets/019-ws-sandbox.md): just-bash + Docker sandboxes via an isolated `sandbox-runner`, review-by-hunk tools, sandbox panel ([PR #19](https://github.com/connorwforsyth/openchat/pull/19))
- [Sandbox-runner CI](tickets/029-sandbox-runner-ci.md): real-Docker smoke test on runc and gVisor; four runner fixes ([PR #19](https://github.com/connorwforsyth/openchat/pull/19))
- [WS-memory-evals](tickets/022-ws-memory-evals.md): Markdown memory with versions and undo, feedback, OTLP traces, dev evals in CI ([PR #17](https://github.com/connorwforsyth/openchat/pull/17))
- [WS-chat-ui](tickets/015-ws-chat-ui.md): app shell (Classic + Workspace panels), conversation with per-hunk approvals, artifacts panel ([PR #21](https://github.com/connorwforsyth/openchat/pull/21))
- [CI-safe timeouts](tickets/035-ci-timeouts.md): test/hook timeouts everywhere with a guard; retried install and compose ([PR #25](https://github.com/connorwforsyth/openchat/pull/25))
- [Access hardening](tickets/032-access-hardening.md), [audit follow-ups](tickets/034-audit-followups.md), [draft runs](tickets/033-run-agent-drafts.md), [agent knowledge](tickets/036-agent-knowledge.md): combined ([PR #27](https://github.com/connorwforsyth/openchat/pull/27))
- [Chat-ui test stability](tickets/037-chat-ui-test-stability.md): deterministic lazy chunks in tests ([PR #26](https://github.com/connorwforsyth/openchat/pull/26))
- [Artifact runtime](tickets/030-artifact-runtime.md): React/Mermaid/HTML/SVG previews on a separate origin ([PR #23](https://github.com/connorwforsyth/openchat/pull/23))
- [Integration: server wiring](tickets/038-integration-server.md): everything booted from the environment and mounted at `/api` ([PR #29](https://github.com/connorwforsyth/openchat/pull/29))
- [Integration: web app](tickets/039-integration-web.md): auth pages, the app shell around every page, persisted cache, composer-first chat routes ([PR #30](https://github.com/connorwforsyth/openchat/pull/30))
- [Contract gaps](tickets/042-contract-gaps.md): invite tokens, health route, budget scope, cache-persistence policy, shortcut sync ([PR #31](https://github.com/connorwforsyth/openchat/pull/31))
- [Server follow-ups](tickets/041-server-followups.md): sandbox tools + per-hunk review in turns, `/api/llm`, `eval.run`, migrations at boot ([PR #32](https://github.com/connorwforsyth/openchat/pull/32))
- [Browser test concurrency](tickets/043-browser-test-concurrency.md): one browser test run at a time machine-wide; stable full runs ([PR #33](https://github.com/connorwforsyth/openchat/pull/33))
- [Integration: Docker + e2e](tickets/040-integration-e2e.md): Dockerfile, compose, Playwright suite (20 pass) that found and fixed 7 bugs ([PR #34](https://github.com/connorwforsyth/openchat/pull/34)); [Integration](tickets/025-integration.md) closed
- [M1 gaps](tickets/044-m1-gaps.md): org creation, invite links, agent picker, model-aware attachments, live titles, trusted proxies ([PR #35](https://github.com/connorwforsyth/openchat/pull/35))
- [Docker verification](tickets/045-docker-verification.md): image, compose on Postgres 17, sandbox runner on runc; one Postgres-only fix ([PR #36](https://github.com/connorwforsyth/openchat/pull/36))
- [Pre-demo audit](tickets/046-m1-predemo-audit.md): §11 checks outside e2e; `/api/openapi.json`, sandbox panel reload fix, brand e2e ([PR #37](https://github.com/connorwforsyth/openchat/pull/37))
- [Preview WebSockets](tickets/049-preview-websockets.md): upgrades pass through the preview proxy ([PR #38](https://github.com/connorwforsyth/openchat/pull/38))
- [Material icons](tickets/048-material-icons.md): Material Symbols set, `icons.set` from config, lucide only for gaps ([PR #39](https://github.com/connorwforsyth/openchat/pull/39))
- [Vendored Material glyphs](tickets/051-vendor-material-glyphs.md): mapped symbols only, ~165k fewer install files ([PR #40](https://github.com/connorwforsyth/openchat/pull/40))
- [Sandbox dev previews](tickets/050-sandbox-dev-previews-build.md): npm create works, Vite previews render in the panel with hot reload ([PR #41](https://github.com/connorwforsyth/openchat/pull/41))
- [Setup CLI](tickets/052-setup-cli.md): `bun run setup` / `up` / `doctor` ([PR #42](https://github.com/connorwforsyth/openchat/pull/42))
- [Docker upload storage](tickets/053-docker-upload-storage.md): uploads stay in the `web-data` volume ([PR #43](https://github.com/connorwforsyth/openchat/pull/43))
- [Loopback origins](tickets/054-loopback-origins.md): sign-in from 127.0.0.1, `TRUSTED_ORIGINS`, clear refusal messages ([PR #44](https://github.com/connorwforsyth/openchat/pull/44))
- [Always-on workspace](tickets/056-workspace-always-on.md): every chat gets file tools; self-healing; `@file` mentions ([PR #46](https://github.com/connorwforsyth/openchat/pull/46))
- [Template restyle](tickets/057-template-restyle.md): template-style chat, slimmer header, new D14 ([PR #47](https://github.com/connorwforsyth/openchat/pull/47))
- [Composer file features](tickets/061-composer-file-features.md): `@` file mentions and `/` file commands ([PR #48](https://github.com/connorwforsyth/openchat/pull/48))
- [Tool status lines](tickets/058-tool-status-lines.md): quiet tool lines and file-change cards ([PR #49](https://github.com/connorwforsyth/openchat/pull/49))
- [Workspace file contract](tickets/055-contract-workspace-files.md): `writeFile`/`importFile`/`deleteFile`, `readFile.etag` ([PR #45](https://github.com/connorwforsyth/openchat/pull/45), merged at Connor's request)
- [Workspace file handlers](tickets/059-workspace-file-handlers.md): server side of the file routes ([PR #51](https://github.com/connorwforsyth/openchat/pull/51))
- [Workspace panel](tickets/060-workspace-panel.md): files + editor, preview, artifacts; no terminal ([PR #52](https://github.com/connorwforsyth/openchat/pull/52))
- [Preview needs a listener](tickets/063-preview-requires-listener.md) ([PR #50](https://github.com/connorwforsyth/openchat/pull/50))
- [Workspace wiring](tickets/062-workspace-wiring-e2e.md): `@file`, `/` commands, attachments into the workspace, e2e ([PR #53](https://github.com/connorwforsyth/openchat/pull/53))
- [Editor theme switch](tickets/064-editor-theme-switch.md): editor text readable across theme changes ([PR #54](https://github.com/connorwforsyth/openchat/pull/54))
- [Mention list race](tickets/065-mention-list-race.md) ([PR #55](https://github.com/connorwforsyth/openchat/pull/55))
- [Gzip previews](tickets/068-preview-gzip.md): the preview proxy no longer forwards a decoded body with its encoding ([PR #56](https://github.com/connorwforsyth/openchat/pull/56))
- [Static preview](tickets/067-static-preview.md): static pages preview with no server; previews survive a runner restart ([PR #57](https://github.com/connorwforsyth/openchat/pull/57))
- [Runner rejoins networks](tickets/069-runner-rejoins-networks.md) ([PR #58](https://github.com/connorwforsyth/openchat/pull/58))
- [Built-in browser preview](tickets/066-workspace-browser.md): Preview as a browser, auto-open, rendered files ([PR #59](https://github.com/connorwforsyth/openchat/pull/59))
- [WS-shell](tickets/024-ws-shell.md): ⌘K palette, shortcut registry, settings and admin ([PR #20](https://github.com/connorwforsyth/openchat/pull/20))
- [WS-libraries](tickets/017-ws-libraries.md): Agent/Prompt/Skill/MCP builders, sharing, publishing and library tabs ([PR #22](https://github.com/connorwforsyth/openchat/pull/22))
- [M1 polish](tickets/031-m1-polish.md): motion audit + guard, narrow-screen layout, batched feedback lookups ([PR #24](https://github.com/connorwforsyth/openchat/pull/24))
- [WS-importers](tickets/023-ws-importers.md): ChatGPT, Claude and LibreChat importers with branch trees; fork ([PR #13](https://github.com/connorwforsyth/openchat/pull/13))
- [WS-ai](tickets/013-ws-ai.md): provider registry, key resolution, agent runner with approvals, Decider, `/api/llm` handler ([PR #11](https://github.com/connorwforsyth/openchat/pull/11))

## Not yet specified

These waves are in scope. Each one graduates into tickets when the gate before it
closes (the M1 demo gate first). Their contents are in `PLAN.md` §2.

- **Desktop:** electron-vite app, cowork mode with a local agent loop and
  permission modes, Quick AI, title bar, native menus, packaging. Open
  questions to expect: how the local loop syncs runs, and the git-checkpoint UX.
- **Collaboration and always-on:** live multi-user chats, `apps/worker`,
  schedules, notifications. Open question: whether live chats need a
  local-first sync engine (Zero, ElectricSQL) rather than the SSE events channel (`PLAN.md` D28).
- **Agents+:** test sets and eval runs, publish gates, sampled scoring,
  per-agent memory, the Jev adapter.
- **Annotate:** the annotate-to-agent loop on artifacts and previews.
- **Mobile and Swift:** the Expo app and the Swift spike.
- **Sandbox follow-ups (from 019):** remote provider adapters (E2B, Vercel
  Sandbox, Microsandbox), an egress-proxy service for allowlist egress, WebSocket
  support in the preview proxy (hot reload), disk quotas on sandbox volumes.
- **Open-source readiness:** licence, brand, docs site, landing page,
  pseudo-locale and RTL gates, SAML, Helm.

## Out of scope

- Billing and payments (usage and budgets are in scope; charging money isn't).
- Running openchat as a hosted SaaS.
