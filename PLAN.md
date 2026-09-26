# openchat — Plan v2

> **Status:** agreed on 2026-09-26, after a design review (the grilling session) of plan v1.
> **Codename:** `openchat` is a working name only. The npm scope and the ICP "OpenChat" chat app are both taken. See D18 for how the brand stays swappable.
> **Audience:** you, and the coding agents that build this. It is the foundation document the Phase 0 agent starts from.

## What changed from v1

v1's research, stack and feature set all carry over. The design review changed the following:

- **Chat turns are server-side _runs_**, not HTTP requests. This fixes a contradiction in v1 (see D4).
- **Zod-first types everywhere.** Messages are stored in our own versioned `MessagePart` schema, not in the AI SDK's `UIMessage` shape.
- **Desktop cowork runs its own agent loop in Electron main.** It no longer uses "server loop + client-side tools" (see D7).
- **One deploy path: Docker + Next.js.** `apps/server` and the Vercel target are dropped for now.
- **Docker sandboxes run behind a separate `sandbox-runner`.** The web container never gets the Docker socket.
- **Tenancy is new:** personal spaces, orgs with a nested team tree, user-owned items, share vs publish, a context per chat, and a policy for whose keys pay.
- **New decisions:**
  - `app.config.yaml` layering;
  - the brand isolated in one place;
  - a swappable icon registry;
  - a Markdown memory file;
  - three eval layers;
  - auth defaults, web search, and security defaults.
- **The Decider** (fast yes/no and scoring model) defaults to a local or cheap LLM, and Jev is opt-in. **Rules always win** over the classifier.
- **Mastra is removed completely.** shadcn components come first; AI Elements are used only where needed and migrated to Base UI.
- **Fact-check corrections** (see §14): Lingui is v6, `WorkflowAgent` lives in `@ai-sdk/workflow`, `MockLanguageModelV4`, Drizzle 1.0 is still RC, AI Elements is Radix-only, Agentation is PolyForm Shield.

---

## 1. Context and goals

We're building a self-hosted, multi-user AI chat platform with LibreChat's feature depth:
- multi-provider agents, MCP, files/RAG, branching, artifacts and search;
- sandboxes;
- shared and multi-user chats.

It is built on a clean TypeScript stack: Turborepo + bun, Next.js, Hono + oRPC, Drizzle + Postgres, and shadcn (Base UI, compatible with /create presets). It also has an Electron desktop app with a local "cowork" mode, an Expo mobile app, and an OpenAPI contract that a native Swift app can consume.

**Who it's for:** you first, as a power user's daily driver, built so it can grow into an open-source product later. Built by you plus coding agents; no hard deadline. The repo stays **private** until open-sourcing; choose the licence then.

---

## 2. Scope: Milestone 1, then parallel waves

### Milestone 1: an ambitious web daily driver

M1 is done when you stop reaching for ChatGPT or Claude.ai for this kind of work. It includes:

- **Accounts:**
  - Auth: the first user becomes admin, then invite-only.
  - Personal space and orgs with a team tree.
  - Chat context and key policy.
- **Chat:**
  - Runs with resumable streaming.
  - Multi-provider support from `app.config.yaml`, plus user and org keys.
  - Branching, edit and regenerate.
  - Full-text search.
  - Artifacts panel.
  - Importers for ChatGPT, Claude and LibreChat history.
- **Agent capability:**
  - Tool approvals.
  - Remote MCP (HTTP/SSE).
  - Web search (provider-native, falling back to our own tool).
  - Files + RAG.
- **Libraries:**
  - The full **Agent Builder, Prompt Library, Skill Builder and MCP Library**.
  - Sharing (use/view/edit), publishing to team and org libraries, versions and drafts.
- **Sandboxes and code:**
  - **just-bash** and **Docker (via `sandbox-runner`)** sandboxes, with the in-chat sandbox panel.
  - `packages/code-ui` (@pierre/trees + @pierre/diffs), with per-hunk review of agent edits.
- **Decider:** the LLM-fallback adapter, used for auto model routing and retrieval gating.
- **Memory:** a Markdown file per user.
- **Evals:** dev evals in CI; feedback and OpenTelemetry trace export; usage and balance.
- **UI infrastructure:**
  - ⌘K palette and the shortcut registry.
  - Icon registry.
  - Lingui macros, with `en` only, and the `lingui extract` missing-keys check in CI.
- **Background jobs:** pg-boss runs **in-process inside `web`** (titles, file ingestion, re-indexing, eval runs). It moves to `apps/worker` in the Collaboration wave without changing any job code (D4).
- **Ops:** `docker compose up` works end to end.

### Waves after M1 (run in parallel, each with its own demo gate)

| Wave | Contents |
|---|---|
| **Desktop** | electron-vite app; cowork mode (local agent loop, node-pty, permission modes, git checkpoints); local stdio MCP; Decider risk check for `auto` mode; Quick AI global-shortcut window + tray; platform-aware title bar; native menus from the shortcut registry; electron-builder packaging and auto-update |
| **Collaboration and always-on** | multi-user live chats (participants, events channel, per-user branch position, run queue); move pg-boss from `web` into `apps/worker` (background runs, scheduled agents UI, ingestion off the web process); notifications (web push, Expo push, email) |
| **Agents+** | agent test sets and eval runs per version (run on pg-boss, in-process in `web` or in `apps/worker` if the Collaboration wave has landed); publish-gate policies; sampled production scoring; per-agent memory scope; Jev adapter |
| **Annotate** | annotate mode on artifacts and sandbox previews; annotation tools for the agent; the resolve/re-open loop |
| **Mobile and Swift** | `apps/mobile` (Expo 57, RN Reusables + Uniwind, `useChat` with `expo/fetch`, `'use dom'` components to reuse the web Markdown and artifact renderers, Better Auth Expo); a Uniwind token file generated from `packages/ui` `globals.css`; `/openapi.json` + Scalar; the Swift spike (D22 / "Swift minimum" below) |
| **Open-source readiness** | choose licence and brand; Blume docs site (its API reference renders from `/openapi.json`); marketing landing page; pseudo-locale and RTL CI gates; SAML; Helm chart; optional `apps/server` / serverless target |

**Swift minimum** (Mobile and Swift wave): `/openapi.json` fed into `swift-openapi-generator`; an `AsyncSequence` SSE parser of about 100 lines for the AI SDK UI message stream; Better Auth `bearer()` + `ASWebAuthenticationSession` + Keychain. No server changes beyond keeping the contract stable. Later: `@better-auth/oauth-provider` (OAuth 2.1 + PKCE).

---

## 3. How it gets built (agent execution model)

1. **Serial foundation.** One agent does this, and you review it:
   - the Phase 0 scaffold;
   - `AGENTS.md` / `CLAUDE.md` conventions;
   - `packages/contract` (zod schemas for messages, runs, agents, library items, grants, config);
   - the port interfaces: `RunExecutor`, `StreamChannel`, `Sandbox`, `Storage`, `ProviderRegistry`, `Decider`, `Embedder`, `SearchBackend`.
2. **Parallel workstreams.** Each agent works in its own git worktree, owns one package or feature, builds against the frozen contracts, writes tests, and opens a PR. CI (`typecheck lint test build`) must pass before merge. The M1 workstreams are listed in §10.
3. **Integration agent.** It wires workstreams into `apps/web`, starts the Playwright smoke suite (configured in Phase 0, first used here) and keeps it green, and reports contract changes back.
4. **Review.** You review a demo at each milestone or wave gate and skim PRs. Changing a contract needs an explicit PR against `packages/contract`, reviewed on its own.

---

## 4. Decisions

### D1: Don't fork LibreChat. Start fresh and borrow selectively

Keep LibreChat as a **read-only reference clone** at `~/GitHub/_reference/LibreChat`, not a fork. Port modules deliberately, with attribution in `NOTICE` (LibreChat is MIT).

Research against LibreChat `main` (v0.8.8-rc4, released 2026-09-20):
- **MongoDB is load-bearing.** There are about 560 mongoose imports. Tenancy, the Meilisearch sync and the LangGraph checkpoints are all Mongoose plugins. In Discussion #3985 (Sept 2024) the maintainer said "a complete refactor for something else is not in order". He was open only to drop-in Mongo replacements; FerretDB later worked. Moving to Postgres would be a rewrite.
- **The frontend is a generation behind.** It uses React 18, React Query v4, Tailwind v3, Recoil and Jotai mid-migration, and mixed Radix / Ariakit / Headless UI. Its tokens aren't shadcn's.
- **Churn is heavy** (about 70 commits a week) and the JS `/api` is half-migrated.

**What to leverage:**
- **Copy and adapt:** `packages/api/src/mcp/*` (MCPManager, UserConnectionManager, OAuth, registry). It is mostly free of mongoose.
- **Use as reference:**
  - The domain model in `packages/data-schemas/src/schema/*.ts`: message tree via `parentMessageId`, presets, balance/transactions, ACL, shares, memory.
  - The provider/param catalogue and the `librechat.yaml` schema in `packages/data-provider/src/config.ts`. This is the model for `app.config.yaml`.
  - Fork logic in `api/server/utils/import/fork.js`, plus the ChatGPT and LibreChat importers.
  - The artifacts prompt in `api/app/clients/prompts/artifacts.js`.
  - The resumable streaming design in `packages/api/src/stream/GenerationJobManager.ts`. This informs D4.

### D2: AI SDK 7 as the core; no Mastra; no @librechat/agents

- **AI SDK 7** (`ai@7.0.x`, Apache-2.0; 7.0.0 shipped 2026-06-25):
  - It's a library, not a framework, so we own the whole schema in Drizzle.
  - Streaming works on web, Expo (`expo/fetch`) and Electron.
  - It provides `ToolLoopAgent`, tool approvals (`ToolApprovalConfiguration`), and MCP via `@ai-sdk/mcp`.
  - Its UI message stream protocol is documented SSE, so a Swift client can parse it.
  - `WorkflowAgent` lives in **`@ai-sdk/workflow`**. It's a later option for durable multi-step agents, behind `packages/ai`.
- **Mastra: removed.** It owns its own thread and message tables, needs an EE licence for RBAC and SSO in Studio, and adds a second agent abstraction. The `packages/ai` boundary stays clean enough to revisit if ever needed.
- **@librechat/agents: skip.** It pulls in LangChain/LangGraph, Node 24 and a stream format we'd have to convert.

### D3: Provider-agnostic, not tied to Vercel

- The AI SDK runs on any host. The Vercel AI Gateway is **optional and off by default**.
- The **`packages/ai` provider registry** (`createProviderRegistry` / `customProvider`) is driven by `app.config.yaml`:
  - Native providers: `@ai-sdk/openai`, `@ai-sdk/anthropic`, `@ai-sdk/google`, Bedrock and Azure.
  - `@ai-sdk/openai-compatible` covers OpenRouter, LiteLLM, Portkey, Cloudflare AI Gateway, Ollama, LM Studio, vLLM, and your own gateway.
  - Model aliases mean the UI never hard-codes a provider.
- **Keys:** instance, org, team and user keys. Which one pays is decided per chat context (D17).

### D4: Chat turns are runs, and always-on AI builds on them

- **A chat turn is a `run`,** not an HTTP request:
  - `POST` creates a run and returns `{ runId, streamUrl }`.
  - The run executes detached from the request, writing chunks to a `StreamChannel`.
  - Any client (web, desktop, mobile, Swift) subscribes, and resumes from a cursor.
  - Closing the tab doesn't stop the run.
- **M1 setup:**
  - An in-process `RunExecutor` inside the web server.
  - `StreamChannel` uses Postgres (a chunk table for resume plus LISTEN/NOTIFY for fan-out). **No Redis and no separate worker are needed.**
  - **pg-boss runs in-process inside `web`** for background jobs (titles, ingestion, re-indexing, eval runs). Job handlers are plain functions registered in one place, so moving them is a deployment change, not a code change.
- **Why pg-boss (v12):** cron schedules, delayed and retrying jobs, singleton and concurrency limits, and nothing to run beyond the Postgres we already have.
- **Collaboration wave:**
  - `apps/worker` (a long-lived Node process) takes over pg-boss and run execution behind the same `RunExecutor` port.
  - Redis becomes an optional `StreamChannel` adapter.
  - Clients don't change.
- **Jobs (in `web` during M1, in `apps/worker` afterwards):**
  - scheduled agent runs (a `schedule` table the user edits in the UI);
  - background runs;
  - file ingestion and embedding;
  - title generation;
  - usage rollups;
  - optional LLM-drafted `.po` translations.
- **Results** land as messages in the conversation, plus notifications.
- **Run states** (a discriminated union): `queued | running | awaiting_approval | succeeded | failed | cancelled`.

### D5: The design system is the single source of truth (Base UI)

- Scaffold with shadcn **`--base base` (Base UI)**, which became shadcn's default in July 2026, from a /create preset. The theme lives only in `packages/ui/src/styles/globals.css` as CSS variables.
- **Use shadcn's own components first.** Use AI Elements only where shadcn has nothing equivalent (for example conversation, message, reasoning and tool parts).
  - AI Elements is **Radix-only today**; the Base UI variant (vercel/ai-elements#450) is unmerged.
  - Install only the components we need and convert them with the `migrate-radix-to-base` skill. From then on they are owned source.
  - When #450 merges, compare it with our copies and adopt it.
- **Rules:**
  - Everything is built from `@workspace/ui` components and semantic tokens (`bg-background`, `text-muted-foreground`, `--radius`, …).
  - No raw hex or palette classes in apps. A CI lint check enforces this.
- **shadcn monorepo layout (CLI v4):** `packages/ui` plus a `components.json` in each app, with `@workspace/ui` aliases and the `--preset` code from /create. The desktop renderer (Vite React) is a **second shadcn app** sharing `@workspace/ui`.
- **Re-theming** is `shadcn apply <preset>`. Web and the desktop renderer follow.
- **Mobile** (Uniwind) reads a token file generated from the same `globals.css`, so light/dark and brand colours match. The generator is owned by the Mobile wave.
- Icons go through `packages/icons` (D19), not via shadcn's `iconLibrary` switch.

### D6: Hosting is Docker-first, with one path

- **`docker compose` services:**
  - `web`: Next.js `output: "standalone"`, with the Hono API mounted at `/api`, running on **Node 24 LTS**;
  - `postgres`: Postgres 17 + pgvector;
  - `sandbox-runner` (D7);
  - optional `searxng` (D23);
  - later: `worker` and optional `redis`.
- **bun** is used for installs, scripts and Turbo. Containers run Node.
- The same images run on a VPS, Coolify, Railway, Fly.io, Render or Kubernetes. A Helm chart comes in the open-source wave.
- Postgres can be the compose service or a managed one (Neon, Supabase, RDS), as long as it has pgvector.
- **Dropped for now:** `apps/server` (standalone Hono) and the Vercel/serverless target. Hono keeps both possible later.
- **Clients:**
  - Electron uses electron-builder, with auto-update via GitHub Releases.
  - Expo uses EAS.
  - Both point at a configurable server URL.
- **Backups** are documented (`pg_dump` plus the file volume), not built in.

### D7: Sandboxes in chats, plus desktop cowork mode

**The sandbox interface.** `packages/sandbox` exposes `Sandbox`: `exec`, `readFile`, `writeFile`, `listFiles`, `exposePort`, `snapshot`, `destroy`. These are wrapped as AI SDK tools (`bash`, `read`, `write`, `edit`, `preview`). Providers:
- **`just-bash`** (vercel-labs, Apache-2.0): a simulated bash with an in-memory filesystem and 70+ commands (grep, sed, awk, jq, optional python/sqlite), used via `bash-tool` (MIT). It spawns no processes, so it's safe anywhere. It is the default per-chat scratch workspace.
- **`docker`**, through a separate **`sandbox-runner`** service. One container per chat (via dockerode, inside the runner), supporting real package installs, dev servers and port preview:
  - It is the **only** component that talks to Docker, via a socket proxy that allows only the needed container API calls.
  - Each sandbox runs under gVisor (`runsc`) where the host supports it. Otherwise it falls back to plain Docker, with a clear warning in the admin UI.
  - Each sandbox has no host mounts, a volume per sandbox, CPU/memory/disk limits, and an egress policy.
  - `web` talks to the runner over an authenticated internal API that implements `Sandbox`.
- **Remote providers:** E2B, Vercel Sandbox, and Microsandbox (pre-1.0; watch it).
  - Avoid Daytona: it went closed-source in June 2026.
  - LibreChat's `ClickHouse/code-interpreter` is an optional provider.
- **`local`** (desktop only; see cowork below).

**Sandboxes inside chats:**
- A `sandbox` table stores conversationId, provider, status and snapshot ref.
- The side panel has a terminal, file tree (`code-ui`), sandbox status and web preview.
- The user can create, attach or reset a sandbox, or let the agent create one.
- Long-running sandbox work runs as a background job, so it survives the tab closing.

**Desktop cowork mode** (Desktop wave):
- The user picks a workspace folder.
- **The agent loop runs in Electron main.**
  - Model calls go through the server's **`/api/llm` proxy** by default: server-held keys, and usage is counted against the chat context.
  - Offline, they go to local keys or Ollama. This is the same code path as offline mode.
- **Tools:**
  - a real shell via `node-pty`, with xterm.js in the renderer;
  - filesystem read/write/edit;
  - local stdio MCP servers.
- **Messages sync** to the server conversation, so the chat appears on web and mobile.
- **Permission modes** (Claude Code-style):
  - `ask`: approve every command and write;
  - `auto-edit`: writes inside the workspace are allowed; commands still ask;
  - `auto`: see the rules-first policy below.
- **Rules-first safety** (from the design review):
  - Deterministic limits are evaluated first: workspace path confinement, a denylist, no network egress unless allowed, and no destructive git operations.
  - Only commands inside those limits reach the Decider, which risk-scores them: **low** runs automatically, **medium** asks, **high** is blocked (the same pattern as LangChain's `AutoModeMiddleware`). It can never unblock something the rules deny.
  - With no Decider reachable, `auto` means allowlist-only.
- Every action is logged to the conversation. Optional git checkpoints make changes undoable.

### D8: Engineering practices

- **Zod-first:**
  - Every type is defined as a zod schema and inferred with `z.infer`. This covers contracts, DB-facing shapes, config, IPC and tool inputs.
  - zod parses every boundary: HTTP, IPC, config, LLM tool input and output.
- **Functional core, imperative shell:**
  - Domain logic is pure functions in packages: `buildBranchPath`, `resolveTools`, `applyPermissionMode`, `chunkDocument`, `resolveChatKeys`, `effectiveGrants`.
  - I/O sits behind small ports passed as function arguments.
  - No DI container, and no classes outside adapters.
- **Immutable data.** Discriminated unions for states: message parts, run status, sandbox status, job status.
- **Errors are values:** a tiny `Result<T, E>` in `packages/shared`, plus oRPC typed errors. No throwing across layers. No Effect-TS.
- **Borrowed patterns:**
  - Claude Code/Codex: permission modes and approvals.
  - Linear/Vercel: the command palette and keyboard-first UX.
  - LibreChat: the domain model.
  - Vercel's Web Interface Guidelines: accessibility and focus.
- **Linting:** Ultracite (Biome) plus lefthook pre-commit, from Phase 0.
- **Conventions for agents** live in `AGENTS.md` / `CLAUDE.md` at the repo root.

### D9: Testing (Vitest + Playwright)

- **Vitest, not Jest.** AI SDK 7 and most of this stack are ESM-only, and Jest's ESM support is still awkward. Vitest is faster and shares the Vite config. `bun test` is fine for tiny packages but lacks Vitest's workspace, browser mode and coverage tooling.
- **LLM tests:** `MockLanguageModelV4` from `ai/test` plus recorded fixtures. The Decider uses `Experimental_EvaluationMockModelV4`. Tests never hit real providers.
- **DB tests:** **PGlite** (in-process Postgres with pgvector) for fast Drizzle query tests. A Docker Postgres runs in CI for integration tests.
- **API tests:** oRPC handlers are tested in-process via Hono `app.request()`. **MSW** mocks outbound HTTP.
- **Component tests:** Vitest browser mode + Testing Library for `ui`, `chat-ui`, `composer` and `code-ui`.
- **E2E:**
  - Playwright covers web and Electron (`_electron.launch`).
  - Maestro covers Expo.
- **Dev evals:** Evalite (Vitest-based, v0.19) in CI (D21).
- **Turbo tasks:** `test`, `test:e2e`, `typecheck`, `lint` and `eval`, all cached. GitHub Actions runs them on PRs.

### D10: Keyboard shortcuts

- The ⌘K palette, new chat, focus composer, stop generation, toggle sidebar, switch model and copy last reply. Desktop menu accelerators match.
- **TanStack Hotkeys** (`@tanstack/react-hotkeys` 0.12, **alpha**): type-safe, cross-platform ⌘/Ctrl, key sequences, **user-recorded shortcuts**, headless. It sits behind `packages/shortcuts`, so `react-hotkeys-hook` can replace it without touching callers.
- One registry (`{ id, keys, description, scope }`) feeds:
  - the web and desktop hooks;
  - Electron accelerators;
  - shadcn `Kbd` hints;
  - the `?` help dialog;
  - the ⌘K palette.

### D11: Client data layer

- **Server state:** TanStack Query v5 everywhere, via `@orpc/tanstack-query`, so keys and types come from the contract.
- **Streaming:** AI SDK `useChat`, with a resumable transport that points at the run stream URL. On finish, and on events-channel messages, it invalidates or patches the Query cache.
- **URL state:** `nuqs` (conversation, branch leaf, panels).
- **Ephemeral state:** a tiny Zustand store (composer draft, palette open).
- No Redux, Recoil or Jotai.

### D12: Localisation (Lingui 6)

- **Lingui v6** (6.0 shipped April 2026). RSC support comes via `@lingui/react/server`. It works across Next.js, Vite/Electron, Expo/RN and shared packages. It uses ICU MessageFormat, macros, and compiled catalogs.
- **Why Lingui:** the alternatives only cover some of our runtimes. next-intl is Next-only; react-i18next is runtime-heavy and untyped.
- `packages/i18n` holds the config, catalogs (`locales/{en,…}/messages.po`), `Intl` formatters (dates, numbers, relative time, file sizes) and locale negotiation (`Accept-Language` → `user.locale`, with a language switch in settings). Shared packages use macros; each app loads the compiled catalogs.
- **From day one (M1):** every user-facing string goes through macros. `en` only. ICU plurals/select, no string concatenation. The `lingui extract` CI check fails on missing or unused keys.
- **In the open-source wave:**
  - a pseudo-locale;
  - RTL (shadcn `--rtl` plus logical utilities `ms-/me-/ps-/pe-`) with an RTL pseudo-locale;
  - LLM-drafted translations as a background job.
- The user's locale is passed into agent instructions.

### D13: Builders and libraries (agents, skills, prompts, MCP)

**Builders:**
- **Agent Builder:** instructions, model/gateway, tools, MCP servers, skills, knowledge files, conversation starters, sandbox provider, and a side-by-side test chat. In the Agents+ wave it gains a **test set and eval tab** (D21).
- **Skill Builder:** Agent Skills format (`SKILL.md` + scripts/resources). Skills can be tested in just-bash or Docker, and are loaded into the agent's sandbox at runtime.
- **Prompt Library:** templates with `{{variables}}`, launched from `/` in the composer and from ⌘K.
- **MCP Library:** saved server configs. HTTP/SSE are server-side; stdio is desktop-only.

**Ownership and sharing:**
- **Items are owned by users.** Your chats, prompts, skills and agents live in your personal space.
- **Share:** grant access to individuals or teams. It's still yours, and revoking access (or you leaving) removes it for them.
- **Publish:** puts a copy into a team or org **library**. The team or org becomes the owner of record and you're a **maintainer**. It survives your departure, and other maintainers can take over.
- **Permission levels** (each includes the ones before):
  - `use`: chat with it, but can't see instructions or read knowledge files;
  - `view`: see the full config and duplicate it to your own library;
  - `edit`: change it.
- **Versions:**
  - Edits are **drafts** until published.
  - Consumers get the **latest published** version, and can optionally pin one.
  - Stored as `*_version` rows.
- **Public links:** any library item can also get a read-only **public link** (`share_link`, the same table chats use), if the instance allows it.
- **Library UI tabs:** My library / Shared with me / Team and org libraries. Includes duplicate-to-personal and import/export (zip/JSON, including LibreChat agents).
- **Grants** use one generic table, `resource_grant(resourceType, resourceId, principalType user|team|org, principalId, permission)`. The permission enum depends on the resource type: library items use `use | view | edit`; chats use `viewer | editor` (D25). Grants to a team **flow down** to descendant teams (D17).

### D14: Command palette, Quick AI and the top bar

- **⌘K palette** (web + desktop; shadcn `Command` + `packages/shortcuts`):
  - search chats;
  - jump to an agent, prompt or skill;
  - actions: new chat with agent X, switch model, switch chat context, toggle sandbox, change permission mode;
  - "Ask AI: …".
- **Desktop Quick AI:**
  - `globalShortcut` (default ⌥Space, configurable) opens a frameless, always-on-top window.
  - Streamed answer, then ⌘↵ "Continue in app".
  - Can attach the clipboard, a screenshot or the frontmost file (with permission).
  - Tray / menu-bar icon.
- **`AppHeader`** lives in `packages/chat-ui` with slots, plus a `platform` context (`web | mac | win | linux`):
  - **Web:**
    - Left: sidebar toggle.
    - Centre: chat title + branch switcher.
    - Right: **chat context chip**, participants/share, sandbox status.
    - The user menu lives in the sidebar footer.
  - **Mac:** `titleBarStyle: 'hiddenInset'`. The header is the draggable title bar (`app-region: drag`, with `no-drag` on controls).
    - Left: traffic lights → sidebar toggle → back/forward.
    - Centre: title + branch switcher (click to open ⌘K).
    - Right: agent/model picker, cowork chip (folder + permission-mode badge), sandbox status, share.
  - **Win/Linux:** `titleBarOverlay`, with the same layout plus padding for the native controls.
- **Native menus** are generated from the shortcut registry.

### D15: The Decider (fast decision layer)

- **`packages/ai/decide`** exposes a pure `Decider` port: `decide(state, questions) → typed answers + probabilities`. Question types: `choice`, `score`, `boolean`. Adapters:
  - **`llm-fallback` (default):** `generateObject` on a small local model (Ollama) or a cheap hosted one, set in `app.config.yaml`.
  - **`jev` (opt-in):** TypeSafe AI's Jev, a non-generative, calibrated decision model.
    - Available on the Vercel AI Gateway (`typesafe-ai/jev`, `experimental_evaluate`, `ai` ≥ 7.0.103) and Cloudflare Workers AI (`typesafe/jev`); its own API is invite-gated.
    - Price: $0.042 per million input tokens; output is free.
    - **Hosted only.** Zero data retention is for enterprise customers only, which is why it's opt-in.
- **Thresholds** live in `app.config.yaml`. Every decision is logged (question, answer, probability) to `decision_log`, for audit and tuning.
- **Invariant:** the Decider can only make things **stricter** in any permission path. It never overrides deterministic rules.
- **Where it plugs in:**
  1. **Auto model routing:** an "Auto" model option scores complexity and intent, and sends each turn to a cheap/fast or a strong model.
  2. **Context selection:** from large personal and org libraries, picks which tools, MCP servers, skills and knowledge files to load for this turn. This keeps context small as MCP catalogs grow.
  3. **Cowork/sandbox `auto` risk scoring:** low runs, medium asks, high blocks, always inside the rules-first limits (D7).
  4. **Retrieval gating:** does this turn need RAG, web search or a memory lookup?
  5. **Multi-user chats:** was this message addressed to the AI or to another participant?
  6. **Memory:** should this fact be saved? (Superseded: memory writes go through the model's `update_memory` tool, D20.)
  7. **⌘K / Quick AI intent:** is the typed text a command or a question?
  8. **Org policy and moderation, plus answer-quality scoring** (groundedness, helpfulness) for evals and analytics.
- **Rollout:**
  - M1: (1) auto model routing, (4) retrieval gating.
  - Desktop wave: (3) cowork/sandbox `auto`-mode risk scoring.
  - Agents+ wave: (2) context selection, (8) answer-quality scoring and org policy/moderation.
  - Collaboration wave: (5) "was this addressed to the AI?".
  - Later: (7) ⌘K / Quick AI intent.

### D16: Code viewing, diffs, and the annotate-to-agent loop

- **@pierre/diffs 1.5.1** (Apache-2.0, stable):
  - Shiki split/unified diffs and plain file view.
  - Line annotations.
  - Accept/reject hunks.
  - Edit mode with annotation remapping.
  - Worker pool and virtualisation.
  - Merge-conflict support is **experimental**.
  - Patch parsing.
- **@pierre/trees 1.0.0-beta.6** (Apache-2.0, **beta**): a virtualised file tree with git-status decorations, search, drag/drop, rename, icon sets (swappable sprites), and React + SSR support.
- `packages/code-ui` wraps both as `FileTree`, `CodeView` and `DiffView`. It maps `--trees-*` / `--diffs-*` variables and a generated Shiki theme to `packages/ui` tokens, so they re-theme with the design system. These components replace AI Elements' file tree and code block on every surface: artifacts, the sandbox panel, the cowork workspace, and code blocks in messages.
- **Phase 0:** `npx skills add pierrecomputer/pierre` (11 skills). Follow the trees and diffs skills.
- **Agent edits are reviewable diffs:**
  - Every `write`/`edit` tool call produces a patch rendered in `DiffView`.
  - In `ask` mode, the user accepts or rejects per hunk, and only accepted hunks are applied.
  - Rejections, with optional line comments, go back to the agent as the tool result.
- **Annotate mode** (Annotate wave):
  - **Built in-house.** Agentation's licence is **PolyForm Shield 1.0.0**, which forbids using it in a product that competes with it, and ours includes an annotation tool.
  - **One `annotation` model for every surface:**
    - `target`: `{kind:'dom', selector, sourceLoc, text, bbox} | {kind:'code', path, lines} | {kind:'diff', hunkId}`;
    - `comment`, `priority`;
    - `status`: `pending | acknowledged | resolved | dismissed`;
    - a reply thread;
    - the artifact or sandbox version it was made against.
  - **Artifact / web preview:**
    - An "Annotate" toggle injects a script into the sandboxed iframe.
    - Hovering outlines an element; clicking opens a comment box.
    - Our artifact bundler stamps `data-src="file:line"`, so annotations carry exact source locations.
    - The same injection works for sandbox dev-server previews and, on desktop, local dev servers.
  - **Code and diffs:** line annotations on `CodeView` and `DiffView`.
  - **The loop:**
    1. Pins and a tray appear above the composer. "Send to agent" attaches them as message parts, or they go along with the next turn.
    2. The agent gets tools: `list_annotations`, `acknowledge_annotation`, `reply_annotation` and `resolve_annotation(id, summary)`.
    3. When the agent resolves, it bumps the artifact version. The UI shows a before/after `DiffView`, re-renders the preview, and marks pins resolved with the agent's summary. Pins can be reopened.
    4. Everything is persisted, and live for collaborators.

### D17: Tenancy: spaces, orgs, the team tree, chat context and keys

- **Personal space:** every user gets a hidden personal org, created on sign-up. This gives one code path instead of two.
- **Orgs:** anyone can create one. Better Auth's organization plugin handles orgs, members, invitations and roles.
- **Teams:** our own **`team` tree** (`team.parentId`) plus `team_member`, because Better Auth's teams are flat. Teams and sub-teams form an org chart.
- **Access flows down:** a grant to *Engineering* includes *Engineering › Platform*.
- **Usage rolls up:** Platform's spend counts toward Engineering's and the org's totals and budgets.
- **Admin visibility:**
  - Admins see metadata and usage by default, never the content of private chats.
  - An **org audit policy** can be switched on by the org owner. It's **off by default**, and members are told when it's on.
  - `app.config.yaml` can forbid audit instance-wide.
- **Chat context:**
  - Every chat has a context: *Personal*, or a team or org the user belongs to.
  - It defaults to Personal. Picking a team-published agent pre-selects that team.
  - It is changeable in the header until the **first message**, then fixed.
  - It decides whose keys pay, where usage rolls up, and whether the audit policy applies.
  - `app.config.yaml` can restrict the allowed contexts (for example `chatContext: [personal]` means always personal).
- **Key resolution** (`resolveChatKeys`, a pure function):
  1. The context's keys (team, then its ancestors, then the org).
  2. If the org allows it (**off by default**), the user's personal keys.
  3. Instance keys, if the admin enables them for that context.
  - In the personal context: user keys, then instance keys (if enabled).
  - Usage is always recorded against both the user and the context.

### D18: Configuration (`app.config.yaml`) and brand

- **Layered configuration:**
  - The **YAML sets instance-wide settings and limits.** Each **org chooses within those limits** in the database, through the admin UI.
  - **The YAML holds:**
    - providers, models and aliases;
    - instance MCP servers;
    - brand;
    - feature flags;
    - auth/signup;
    - search backends;
    - the Decider;
    - storage;
    - limits and budgets;
    - allowed policies and their defaults (`chatContext`, `auditPolicy`, `personalKeyFallback`, `publishGate`, `sampledScoring`).
  - **The database holds** each org's choices, team budgets, and user settings.
- **Secrets** come in through `${ENV}` interpolation, and are never written to the file.
- The file is found via `CONFIG_PATH`. It is validated with a zod schema in `packages/config` at boot, and fails fast with readable errors. Changes apply on restart.
- **Brand isolation:**
  - Packages use shadcn's `@workspace/*` scope, so the brand appears in no import.
  - The config file has a brand-neutral name, `app.config.yaml`.
  - The name lives only in the YAML `brand:` block (name, logo, favicon, app ID, URL scheme, desktop and mobile identifiers), the root `package.json` name, and the Docker image names.
  - **A CI check fails** if the literal string `openchat` appears anywhere else. Allowed exceptions: those three places, `PLAN.md`, and the `.wayfinder/` tracker.

### D19: Icons: one swappable registry

- **`packages/icons`**, with web and React Native entry points:
  - It exports icons **named with lucide's names**: `ChevronRightIcon`, `SendIcon`, and so on. This is the shared vocabulary, because shadcn's placeholder, AI Elements and React Native Reusables all speak lucide.
  - It also exports a few semantic aliases (`BranchIcon`, `ContextIcon`, …).
- **Set mapping files:** `lucide.ts`, `phosphor.ts`, `tabler.ts`, `hugeicons.ts`, `material.ts`, and so on.
  - The YAML chooses the set at **build time**, for example `icons: { set: material, style: rounded, weight: 400, fill: false }`. Unused sets are removed from the bundle.
  - Icons missing from a set fall back to lucide, and CI lists the gaps.
- **Material Symbols** are generated as SVG components from `@material-symbols/svg-{100..700}` (Apache-2.0). Styles are outlined, rounded or sharp, plus fill. The variable font is not used.
- **Keeping installs honest:**
  - `shadcn` `iconLibrary` stays on `lucide`.
  - A **codemod** runs after every `shadcn add` or AI Elements install. It rewrites `from "lucide-react"` (and `lucide-react-native`) to `from "@workspace/icons"`.
  - A **lint rule** bans importing icon libraries directly outside `packages/icons`.
- **Other consumers:**
  - @pierre/trees gets a sprite sheet generated from the active set.
  - Streamdown gets its `icons` prop from the registry.
  - @pierre/diffs keeps its few internal glyphs; our own header replaces its file header.

### D20: Memory

- Each user has **one Markdown memory file**, like a `CLAUDE.md`. It is injected into every chat, up to a size cap. Users can edit it directly in settings.
- **The agent updates it through an `update_memory` tool.**
  - Changes **apply automatically** and are stored as **versions** in `memory_version`.
  - The agent says so in its reply ("I'll remember that you prefer pnpm").
  - A small "Memory updated · Undo" note sits under that message. It doesn't interrupt.
  - A per-user setting switches to "propose changes as a diff" instead, reusing `DiffView`.
- **Never** updated from shared or multi-user chats.
- **Per-agent memory scope** comes in the Agents+ wave.
- Full-text search over past chats covers "recall across conversations".

### D21: Evals and observability

Three layers share one core in `packages/ai/evals`: datasets, a runner and scorers.

1. **Dev evals (Phase 0/1, in CI):**
   - Evalite suites check our own prompts and logic: the artifact prompt yields valid artifacts, the Decider routes sensibly, and tool calling works across providers.
   - Recorded fixtures by default, with an optional live run.
2. **Agent evals (Agents+ wave):**
   - Each agent can have a **test set**: inputs plus expected outputs or rubrics.
   - When a version is saved or published, the test set runs as a pg-boss job (in `web`, or in `apps/worker` once it exists).
   - Scorers: deterministic checks, an LLM judge, or a Decider score.
   - Results are stored per version ("v4 vs v3: 18/20 → 19/20").
   - A conversation can be turned into a test case with one click.
   - **Publish gate:** each library sets its own policy (for example *Engineering* requires "no regressions"). The default is **informational only**.
3. **Production quality:**
   - M1: thumbs up/down feedback.
   - Agents+ wave: sampled scoring (groundedness, helpfulness), and dashboards per agent, team and model.
   - **Privacy:**
     - Maintainers see **aggregate scores only**.
     - Conversation content is visible only if the user ticks **"Share this conversation with the agent's maintainers"**, or under the org audit policy.
     - Sampled scoring runs only in contexts where the org has enabled it.

**Build vs adopt: a hybrid.**
- Everything users see (feedback, test sets, eval runs, scores) lives in **our Postgres and UI**, with the same permissions as everything else.
- **Developer and ops tracing:** AI SDK telemetry is exported via OpenTelemetry to whatever `app.config.yaml` configures (Langfuse via `@langfuse/otel`, Phoenix, Braintrust, or any OTLP endpoint). **Off by default.**

### D22: Auth and sign-up

- **Better Auth 1.7** with the Drizzle adapter:
  - email + OAuth (GitHub and Google first) + generic OIDC;
  - organization plugin;
  - admin plugin;
  - `bearer()` for Swift;
  - `@better-auth/expo` and `@better-auth/electron` (system browser + PKCE);
  - later, `@better-auth/oauth-provider` (OAuth 2.1 + PKCE).
- **Default sign-up:** the first user becomes instance admin, then invite-only.
- **YAML options:**
  - open sign-up;
  - an email domain allowlist (optionally combined with invites);
  - SSO-only via OIDC.
- SAML arrives in the open-source wave, unless a work deployment needs it sooner.

### D23: Web search

- The model provider's **built-in search** (Anthropic or OpenAI web search tools) is used when the selected model supports it and the admin allows it.
- Otherwise, our own **`web_search` tool** with pluggable backends set in `app.config.yaml`: SearXNG (self-hosted, free, included as an optional compose service), Brave, Tavily or Exa.

### D24: Security defaults

- **Secrets at rest:** provider keys and MCP OAuth tokens are encrypted with AES-GCM using `ENCRYPTION_KEY`. Each ciphertext carries a key ID, so the key can be rotated.
- **Artifacts and previews:** served from a **separate origin**, in sandboxed iframes, never sharing app cookies.
- **Sandboxes:** see `sandbox-runner` (D7). The web container never gets the Docker socket.
- **Desktop filesystem access** goes only via preload `contextBridge` → `ipcMain.handle`, limited to user-approved roots. IPC payloads are zod-parsed.
- **Rate limits and budgets:** per user, team and org, from the YAML plus each org's settings, enforced before the run is created.

### D25: Multi-user chat semantics (Collaboration wave)

- **Per-user branch position:** each participant has their own `activeLeafId`.
  - Activity on other branches shows as a badge ("Alice is on branch 3 · jump").
  - Users can **follow** another participant.
- **One run per branch at a time:**
  - A second prompt on a busy branch is **queued** ("queued after Alice"), and can be cancelled.
  - Editing an earlier message creates a sibling branch as normal.
- **Access:**
  - `resource_grant` is the **only** authority on who can see or prompt in a chat: `viewer` (read and follow along) or `editor` (can prompt). The owner is always an editor.
  - `conversation_participant` holds per-user state only (`activeLeafId`, following, last read); it grants nothing.
  - Messages record `authorId`.
  - Public read-only links use `share_link`.
- **Events:** participants subscribe to `GET /api/conversations/:id/events` (SSE) for new messages, runs, queue changes and typing.

### D26: API layer (Hono + oRPC)

- **The real API surface is the oRPC zod contract** in `packages/contract`. It generates a typed TypeScript client and an OpenAPI 3.1 spec (the Swift path). Hono is only the thin HTTP adapter, so it's swappable.
- **Why Hono, not Express:**
  - It's built on the standard Web `Request`/`Response`. The **same app object** runs unchanged inside a Next.js route handler (`app/api/[[...route]]/route.ts`), standalone on Node or Bun, on Cloudflare or Lambda, or mounted in Express via `@hono/node-server`.
  - Express uses Node-only req/res, so it can't run inside Next route handlers or edge runtimes.
  - It has first-class streaming/SSE helpers, typed middleware and zod-openapi.
  - It's also faster than Express, but that's a bonus, not the reason.

### D27: Performance: composer-first (from performance.dev/chatgpt)

The organising question for boot is **"can you type yet?"** ChatGPT's web app (React 19, React Router 7, Tailwind v4 over a token layer, ProseMirror, TanStack Query) is the reference.
- **Composer:** TipTap (MIT packages only) on ProseMirror. The server renders a visually identical static `ComposerShell`; the editor chunk loads lazily and hydrates over it with no layout shift. A `composer:ready` performance mark is the headline metric.
- **Defer everything behind the composer:** only the entry, React and the matched route are preloaded. Code views (`code-ui`), the artifacts panel, reasoning views, KaTeX, settings and admin load on demand, each with its own CSS where possible.
- **Messages are not virtualised.** Conversations are usually short, and find-in-page matters. Streaming markdown is re-rendered in place per chunk (Streamdown handles unfinished fences and tables); `content-visibility: auto` on older messages is allowed.
- **Math:** KaTeX with its MathML output kept, so formulas are selectable and screen-readable.
- **Boot data:** server-evaluated config and flags are inlined into the page (no boot round trip), and the TanStack Query cache is hydrated from the server. The theme is applied by an inline script before paint.
- **Fonts:** self-hosted only (no third-party font requests); the preset decides whether that's Geist or the system stack.
- **Assets are first-party** (same origin, long cache headers). No service worker: offline chat is useless without the model backend.
- **Measure from the first byte:** record TTFB, `composer:ready` and first-token latency in the M1 end-to-end checks.

---

## 5. Stack (versions checked 2026-09-26)

| Area | Choice | Version / note |
|---|---|---|
| Monorepo | Turborepo + bun workspaces (`catalog` pins React 19.2.x) | Convert shadcn's `pnpm-workspace.yaml` to `package.json` workspaces |
| Web | Next.js 16 (App Router), `output: standalone`, Node 24 LTS | |
| API | Hono + oRPC (zod contract → typed client + OpenAPI 3.1) | Mounted at `/api` in Next.js (D26) |
| AI | `ai` 7.0.x, `@ai-sdk/*` providers, `@ai-sdk/mcp` 2.x | `@ai-sdk/workflow` later, if needed |
| DB | Postgres 17 + pgvector; **drizzle-orm 1.0.0-rc (exact pin)** | Stable is 0.45.3. Fall back if the Phase 0 check fails. Postgres full-text search (tsvector) instead of Meilisearch; pgvector RAG in-process instead of LibreChat's Python `rag_api`: one database, nothing extra to run |
| Queue | pg-boss 12 | In-process in `web` from M1; `apps/worker` from the Collaboration wave |
| Auth | better-auth 1.7.6 (+ expo, electron, oauth-provider) | |
| UI | shadcn 4.21 (`--base base`, `--monorepo`, `--preset`) + selected AI Elements (migrated) | AI Elements Base UI PR #450 pending |
| Code UI | @pierre/diffs 1.5.1, @pierre/trees 1.0.0-beta.6 | Trees is beta |
| Sandboxes | just-bash 3.4 + bash-tool 1.3; Docker via `sandbox-runner` (+ gVisor) | Microsandbox 0.7 (pre-1.0), E2B, Vercel Sandbox |
| i18n | Lingui 6.8 | |
| Shortcuts | @tanstack/react-hotkeys 0.12 (alpha) | Fallback: react-hotkeys-hook |
| Client data | TanStack Query v5 + @orpc/tanstack-query, nuqs, Zustand | |
| Icons | `packages/icons` over lucide / phosphor / tabler / hugeicons / @material-symbols/svg-* 0.47 | |
| Evals | Evalite 0.19 (dev); own tables (product); OpenTelemetry export (Langfuse `@langfuse/otel` 5.x, optional) | |
| Desktop | electron-vite, node-pty, xterm.js, electron-builder | |
| Mobile | Expo 57.0.x (React 19.2.3, RN 0.86.3), Expo Router, RN Reusables + Uniwind | Reusables' support for SDK 57 unverified |
| Docs | Blume 2.0 (Astro/Vite, MDX, `openapi()`) | Open-source wave |
| Lint/format | Ultracite (Biome) + lefthook | |
| Tests | Vitest, PGlite, MSW, Playwright, Maestro | |

---

## 6. Repo layout (`~/GitHub/openchat`)

```
apps/
  web/        Next.js 16 — mounts @workspace/server at /api; (marketing) route group later
  desktop/    [Desktop wave] electron-vite: main (agent loop, IPC, FS/shell tools, local stdio MCP), preload, renderer
  mobile/     [Mobile wave] Expo 57 + Expo Router + RN Reusables/Uniwind; 'use dom' reuse of web markdown/artifact renderers
  worker/     [Collaboration wave] takes over pg-boss from web: runs, schedules, ingestion, rollups, evals
  sandbox-runner/  Only Docker-privileged service; implements Sandbox over an internal API
  docs/       [OSS wave] Blume 2.x — MDX guides + OpenAPI reference; theme maps to ui tokens
packages/
  contract/   oRPC contract + zod schemas — single source of truth; emits OpenAPI
  shared/     Result type, ids, small pure utils
  config/     app.config.yaml zod schema, loader, env interpolation, policy bounds
  db/         Drizzle schema, migrations, queries (pgvector, tsvector)
  auth/       Better Auth config, personal-org bootstrap, team tree, per-platform clients
  server/     Hono app: oRPC handlers, runs + stream routes, events SSE, /api/llm proxy, uploads
  ai/         Provider registry, key resolution, RunExecutor, agent runner, tool registry, RAG,
              artifacts prompt, decide/ (Decider port + adapters), evals/ (datasets, runner, scorers)
  mcp/        MCP connection manager (adapted from LibreChat packages/api/src/mcp)
  sandbox/    Sandbox interface + providers (just-bash, docker-client, e2b, vercel, microsandbox, local) + AI SDK tools
  ui/         shadcn primitives + selected AI Elements (Base UI) + globals.css
  icons/      Icon registry (web + native), set mappings, codemod, sprite generator
  composer/   Prompt composer (attachments, model/agent picker, context chip, slash commands, mentions) — standalone, reusable elsewhere
  chat-ui/    Conversation, messages/branches, artifacts + sandbox panels, AppHeader, memory note
  code-ui/    FileTree / CodeView / DiffView over @pierre/*, themed from ui tokens; annotation overlay
  shortcuts/  Shortcut registry + hooks + Electron accelerator mapping
  i18n/       Lingui config, catalogs, Intl formatters, locale negotiation
  client/     Typed oRPC client + TanStack Query hooks (web, desktop, mobile)
  typescript-config/, biome config (Ultracite)
```

**Build rules:** `packages/*` are just-in-time TypeScript packages. Only `apps/sandbox-runner`, `apps/worker` and the Electron main bundle compile.

---

## 7. Core data model (`packages/db`)

- **Better Auth tables:** `user` (+ `locale`), `session`, `account`, `verification`, `organization` (+ `isPersonal`), `member`, `invitation`.
- **Tenancy:**
  - `team` (id, orgId, parentId, name);
  - `team_member` (teamId, userId, role);
  - `org_settings` (policy choices within YAML limits: audit, key fallback, sampled scoring, publish gate defaults);
  - `budget` (principal, period, limit).
- **Access:**
  - `resource_grant` (resourceType, resourceId, principalType user|team|org, principalId, permission). The permission is validated per resource type: `use | view | edit` for library items, `viewer | editor` for chats. This table is the only source of access.
  - `share_link` (resourceType, resourceId, token, expiry, revoked): public read-only links for chats and library items.
- **Chat:**
  - `conversation`: id, ownerId, **contextType personal|team|org, contextId**, title, default agent/model, archived, tsvector.
  - `conversation_participant`: conversationId, userId, **activeLeafId**, followingUserId, lastReadAt. Per-user state only; access comes from `resource_grant`.
  - `message`: id, conversationId, **parentId** (tree), authorId (null for assistant), role, **`parts` jsonb (our `MessagePart` union) + `partsVersion`**, model, usage, runId, tsvector.
  - `run`: id, conversationId, parentMessageId, status union, executor, cursor, error, timings, contextType/contextId.
  - `run_chunk`: runId, seq, payload. Used for resume; pruned after completion.
- **Library** (each owned by a user or by a team/org once published; `maintainers[]`; `visibility` private | shared | published | public-link):
  - `agent` + `agent_version`. A version holds instructions, model/alias, tools, MCP servers, skills, knowledge files, conversation starters and sandbox provider. `agent` points at its draft and latest published version.
  - `prompt` + `prompt_version` (template, `{{variables}}`)
  - `skill` + `skill_version` + `skill_file`
  - `mcp_server` (scope, transport, encrypted OAuth tokens)
  - `preset` (model, parameters, instructions)
- **Files and RAG:**
  - `file` (storage key: local volume or S3-compatible);
  - `file_chunk` (embedding vector, pgvector HNSW; embedding model + dimension recorded);
  - `artifact` + `artifact_version` (linked to a message).
- **Sandboxes:** `sandbox` (conversationId, provider, status, snapshotRef, limits).
- **Annotations** (Annotate wave): `annotation`, `annotation_reply`.
- **Keys and usage:** `provider_key` (scope instance|org|team|user, encrypted, keyId), `transaction` / `balance` (recorded per user **and** context).
- **Memory:** `memory` (userId, content), `memory_version`.
- **Evals and quality:**
  - `feedback` (messageId, rating, comment, shareWithMaintainers);
  - `eval_dataset`, `eval_case`, `eval_run` (agentVersionId), `eval_result`;
  - `quality_score` (sampled).
- **Decider:** `decision_log` (question, answer, probability, adapter, context).
- **Collaboration wave:** `schedule`, `notification`, `push_subscription`.

---

## 8. Key flows

**Chat run:**
1. The client sends `POST /api/runs` with `{ conversationId, parentId, parts, agentId | model, context? }`. The server validates it and checks the budget.
2. It persists the user message. If the branch already has an active run, the new run is `queued`. It returns `{ runId, streamUrl }`.
3. The `RunExecutor` (in-process in M1, the worker later) takes over:
   1. Loads the branch path (`buildBranchPath`).
   2. Resolves the agent's published version, tools, MCP servers and skills.
   3. Resolves keys (`resolveChatKeys`).
   4. Asks the Decider for routing and retrieval.
   5. Runs `streamText` / `ToolLoopAgent`, writing UI-stream chunks to the `StreamChannel`.
4. The client consumes `GET /api/runs/:id/stream?cursor=` (SSE, AI SDK UI message stream protocol). It can reconnect and resume from any client.
5. The assistant message is persisted as our `MessagePart` schema. Usage is recorded against the user and the context.
6. On tool approval, the run pauses as `awaiting_approval`. Any editor can approve or reject via `POST /api/runs/:id/approvals`. In `ask` mode, the rejection with its per-hunk decisions becomes the tool result.

**Desktop cowork:**
1. Electron main runs the agent loop.
2. Model calls go to `/api/llm`, or to local keys or Ollama.
3. Tools run locally, under the permission mode and the rules-first policy (D7).
4. Messages and runs sync to the server conversation.
5. Local stdio MCP servers run in main.

**MCP (server):** org-, team- and user-configured HTTP/SSE servers via `packages/mcp`. Their tools are merged into the agent's tool set.

**RAG:**
1. Upload to storage (local volume or S3-compatible). Steps 2–4 run as a pg-boss job.
2. Parse in-process (unpdf for PDF, mammoth for docx, plain text). A Docling service is optional later.
3. Chunk (`chunkDocument`).
4. Embed with `embedMany` into pgvector. The model is set in the YAML; changing it starts a re-index job.
5. A `file_search` tool does retrieval, gated by the Decider.

**Branching:** editing or regenerating creates a sibling under the same `parentId`, and the branch switcher shows siblings. "Fork" copies a path into a new conversation (logic ported from LibreChat's `fork.js`). "Move" or "copy to context" is available before the context is fixed.

**Memory:** the chat includes the memory file. The agent calls `update_memory(patch)`, which writes a new `memory_version`. The message shows "Memory updated · Undo". This is disabled in shared chats.

**Share vs publish:**
- **Share** writes `resource_grant` rows.
- **Publish:**
  1. Copies the item into the target library, owned by that team or org, and sets maintainers.
  2. Creates a `*_version`.
  3. Runs the test set if there is one.
  4. Applies the library's publish-gate policy.

---

## 9. `app.config.yaml` sketch

```yaml
version: 1
brand:
  name: openchat            # codename — change here (and root package.json + image names)
  appId: dev.openchat.app
  urlScheme: openchat
  logo: ./brand/logo.svg
auth:
  signup: invite            # open | invite | domain
  domains: []               # used when signup: domain (optionally with invites)
  oidc: []                  # SSO providers
providers:
  anthropic: { apiKey: ${ANTHROPIC_API_KEY} }
  openai:    { apiKey: ${OPENAI_API_KEY} }
  ollama:    { type: openai-compatible, baseURL: http://ollama:11434/v1 }
models:
  aliases:
    fast:   anthropic:claude-haiku-4-5
    strong: anthropic:claude-opus-5-5
  auto: { enabled: true, cheap: fast, strong: strong }
policies:                   # instance-wide limits; orgs choose within them
  chatContext: [personal, team, org]
  auditPolicy: allowed      # allowed | forbidden
  personalKeyFallback: allowed
  instanceKeys: { personal: true, org: false }
  publishGate: { default: informational }
  sampledScoring: allowed
decider:
  adapter: llm-fallback     # llm-fallback | jev
  model: fast
  thresholds: { autoRouteStrong: 0.6, needsRetrieval: 0.5 }
search:
  native: true
  backend: searxng          # searxng | brave | tavily | exa
  searxng: { url: http://searxng:8080 }
sandbox:
  default: just-bash
  docker: { runnerUrl: http://sandbox-runner:7070, runtime: runsc, limits: { cpu: 2, memoryMb: 2048 } }
storage: { driver: local, path: /data/files }   # or s3-compatible
embeddings: { model: openai:text-embedding-3-small }
icons: { set: lucide }      # e.g. { set: material, style: rounded, weight: 400, fill: false }
observability: { otlp: null }
limits: { requestsPerMinute: 60 }
features: { importers: true }
```

---

## 10. Phased execution

### Phase 0: foundation (serial, one agent, reviewed by you)

1. Clone LibreChat to `~/GitHub/_reference/LibreChat` (`--depth 1`, read-only).
2. `bunx shadcn@latest init -t next --monorepo --base base --preset <code from /create>`. Convert to bun workspaces (`catalog` pins React 19.2.x). Add Turborepo tasks: `dev`, `build`, `lint`, `typecheck`, `test`, `test:e2e`, `eval`, `db:*`.
3. Tooling:
   - `packages/typescript-config`;
   - Ultracite + lefthook;
   - a Vitest workspace, with Playwright configured (the Integration workstream writes the first smoke tests);
   - GitHub Actions CI;
   - `docker-compose.yml` (postgres + pgvector, optional searxng).
4. `AGENTS.md` / `CLAUDE.md` covering the conventions in D8, the token rules, the icon and i18n rules, and the contract-change process.
5. Contracts and ports:
   - `packages/contract` (zod) and `packages/config` (the `app.config.yaml` schema);
   - `packages/shared` (`Result`);
   - port interfaces in `ai`, `sandbox` and `server`.
6. `packages/i18n` (Lingui 6 macros, `en`) and `packages/icons` (lucide set + codemod + lint rule).
7. Install the pierre skills. Install the AI Elements components we need and migrate them to Base UI.
8. CI checks: token lint, icon-import lint, brand-string check, `lingui extract` missing/unused keys.
9. **Risk checks** (§12). Record the results in `docs/decisions/`.

### Phase 1: parallel workstreams to Milestone 1

Each workstream is one agent, in its own worktree, with its own PR:

| Workstream | Owns |
|---|---|
| WS-db | Drizzle schema + migrations for §7 (M1 tables), query modules, PGlite test harness |
| WS-auth | Better Auth, personal-org bootstrap, orgs, team tree, invites, sign-up policies, grant resolution (`effectiveGrants`) |
| WS-runs | `RunExecutor` (in-process), Postgres `StreamChannel`, runs/stream routes, queueing, approvals, resumable `useChat` transport; in-process pg-boss and the job registry; title generation |
| WS-ai | Provider registry from YAML, `resolveChatKeys`, agent runner, tool registry, Decider (`llm-fallback`), `/api/llm` proxy |
| WS-chat-ui | Conversation view, branch switcher, AppHeader + context chip, artifacts panel, memory note, feedback |
| WS-composer | Composer, attachments, model/agent picker, slash prompts, mentions |
| WS-libraries | Agent, Prompt, Skill and MCP builders; share/publish; versions/drafts; library tabs; import/export |
| WS-mcp | Port the LibreChat MCP manager; HTTP/SSE; OAuth; org/team/user scopes |
| WS-sandbox | `Sandbox` interface, just-bash provider, `apps/sandbox-runner` (Docker + gVisor + socket proxy), sandbox panel |
| WS-code-ui | FileTree/CodeView/DiffView, token theming, per-hunk review wired to write/edit tools |
| WS-knowledge | Files, storage drivers, parsing, chunking, embeddings, `file_search`, full-text search, web search tool + SearXNG |
| WS-memory-evals | Memory file + versions, `update_memory`, feedback, OpenTelemetry export, Evalite dev-eval suites |
| WS-importers | ChatGPT, Claude and LibreChat importers; fork |
| WS-shell | ⌘K palette, shortcut registry, settings, admin UI (org policies, keys, budgets, audit) |
| Integration | Wires into `apps/web`, Playwright smoke suite, and the compose end-to-end check |

### Waves after M1 (parallel)

The wave table is in §2.

---

## 11. Verification

**Every phase:**
- `bun install && bun turbo typecheck lint test build` passes.
- `bun turbo eval` passes (fixtures).
- `bun turbo test:e2e` (Playwright) passes from the end of M1 (web), and from the Desktop wave (Electron).

**M1 end-to-end.** Run `docker compose up`, then `bun turbo db:migrate`, then `bun dev`. Check each step in the built-in browser:
1. The first sign-up becomes admin. A second user can only join by invite.
2. Create an org and a team tree (*Eng › Platform*).
3. Chat with streaming. **Close the tab mid-reply, reopen, and the stream resumes.** Edit a message to branch. Search finds the chat.
4. Switch the chat context to *Platform* before the first message. The team key pays, usage rolls up to *Eng* and the org, and the context locks after sending.
5. **Sharing:**
   - User A publishes an agent to *Eng*. User B in *Platform* sees it under the team library and can **use** it, but can't see its instructions.
   - With **view**, B sees them and can duplicate.
   - Removing A from the org leaves the published agent working.
   - User A **shares** a personal agent with B. It appears under B's "Shared with me", B can use it, and B **can't edit it** until A grants `edit`.
6. **Sandboxes:**
   - just-bash: the agent runs `ls && echo hi > a.txt && cat a.txt`.
   - Docker: the agent runs `npm create vite` + a dev server, and the preview loads.
   - `web` has no Docker socket mounted, and `sandbox-runner` reports `runsc` or a warning.
7. **Per-hunk review:** rejecting one hunk in `ask` mode leaves it unapplied, and the agent receives the rejection.
8. **Memory:** "remember I prefer pnpm" updates the memory file, shows the undo note, and Undo reverts. Nothing is saved from a shared chat.
9. **i18n:** `lingui extract` in CI reports zero missing keys.
10. **Background jobs:** a new chat gets a generated title, and an uploaded PDF becomes searchable, both via in-process pg-boss.

**Config and brand:**
- An invalid `app.config.yaml` fails at boot with a readable error.
- Changing `brand.name` renames the app everywhere.
- The CI brand check catches a stray `openchat` string.

**Icons:**
- Switching `icons.set` to `material` and rebuilding changes the icons in shadcn primitives, AI Elements, the file tree and Markdown.
- CI lists unmapped icons.

**Contract:**
- Vitest covers handlers and queries (PGlite, plus Docker Postgres in CI).
- `/openapi.json` passes Redocly lint.

**Desktop wave:**
- `bun --filter desktop dev`: grant a folder, then list and read a file.
- Writes prompt in `ask` mode. `auto-edit` writes silently but asks for commands.
- In `auto` mode, a denylisted command is blocked even if the Decider scores it low-risk.
- Offline with Ollama works.
- ⌥Space opens Quick AI, and "Continue in app" works.
- The mac title bar drags, and its controls stay clickable.

**Collaboration wave:**
- Two browser sessions in one chat both see a streaming reply live.
- The second prompt on a busy branch queues.
- Per-user branch positions and following work.
- A scheduled agent run lands a message and sends a notification.

**Agents+ wave:**
- A test set runs on publish and shows v(n) vs v(n-1).
- A "no regressions" library blocks a regressing publish.
- A maintainer sees scores but not content, unless the user shared it.

**Annotate wave:**
1. Annotate a button ("make this primary") in an HTML or React artifact.
2. The agent acknowledges and edits.
3. `DiffView` shows the change, the preview updates, and the pin is resolved with a summary.

**Mobile wave:**
- Run in the iOS Simulator (panel attached), sign in, stream a reply, and resume after backgrounding the app.
- Light/dark and brand colours match web (generated Uniwind tokens).

**Open-source readiness wave:**
- `apps/docs` (Blume) builds, and its API reference renders from `/openapi.json`.
- Switching to the pseudo-locale shows no untranslated strings; the RTL pseudo-locale lays out correctly.

**Swift spike:**
- The generated client plus the SSE parser stream a run.

---

## 12. Phase 0 risk checks (these can still change a decision)

1. **Drizzle 1.0 RC** works with Better Auth's Drizzle adapter and PGlite. *If not:* use 0.45 stable and plan an upgrade.
2. **bun + Expo autolinking** and **electron-builder native modules** (node-pty) work. *If not:* use pnpm just for those apps, or switch to pnpm workspaces.
3. The **AI Elements** components we need migrate cleanly to Base UI. *If not:* build those few components on shadcn primitives.
4. **Next.js 16 standalone on Node 24** works with the Hono mount and SSE streaming (no buffering).
5. **gVisor availability** on your Docker host (Docker Desktop on macOS vs a Linux VPS). Document the fallback.
6. **React Native Reusables on Expo SDK 57** (unverified). Mobile wave only.

---

## 13. Decision log (design review, 2026-09-26)

| # | Question | Decision |
|---|---|---|
| Q1 | Who is it for? | You first, growable into an open-source product |
| Q2 | Who builds it? | You + agents; no hard date |
| Q3 | Request or run? | **Run**, from Phase 1 |
| Q4 | Message storage | Own zod-defined versioned `MessagePart`; AI SDK protocol on the wire; zod-first everywhere |
| — | Mastra | Removed |
| Q5 | AI Elements vs Base UI | shadcn components first; AI Elements only where needed, migrated to Base UI |
| Q6 | Classifier as security gate | Rules decide; the classifier can only make things stricter |
| Q7 | Drizzle | 1.0 RC, exact pin |
| Q8/Q14 | First milestone | Ambitious web M1, then parallel waves; desktop definitely included |
| Q9/Q13/Q18 | Tenancy | Personal space by default; anyone can create orgs; nested team tree; user-owned items |
| Q10 | Deployment | Docker + Next.js only |
| Q11 | Phase 0 discipline | Lint, CI, Vitest and Lingui macros from day one; docs, marketing and pseudo-locale deferred |
| Q12 | Repo | Private; licence decided later |
| Q15 | Desktop loop | In Electron main, via the server `/api/llm` proxy or local |
| Q16 | Build process | Serial foundation, then parallel agent workstreams; demo gates + PR skim |
| Q17/Q26 | Name | Codename `openchat`; `@workspace/*` scope; brand in one YAML block; CI check |
| Q19 | Org chart behaviour | Access flows down, usage rolls up, audit policy opt-in (off by default) |
| Q20 | Whose key pays | Context keys first; personal fallback only if the org allows (off by default) |
| Q21 | Share vs publish | Share = grant; publish = copy owned by the team or org |
| Q22 | Chat context | User-chosen, pre-selected by the agent, locked at the first message; always-personal is a YAML option |
| Q23 | Sharing chats | Same grant system (viewer/editor) |
| Q24 | Permissions and versions | use/view/edit; drafts until published; consumers get the latest published version |
| Q25 | Config layering | The YAML sets limits; orgs choose within them in the DB |
| Q27/Q30 | Icons | Registry with lucide-named vocabulary, codemod + lint, build-time set; Material Symbols as SVG |
| Q28 | Decider | LLM fallback by default; Jev opt-in later |
| Q29 | Shared-chat branching | Per-user branch position; one run per branch with a queue |
| Q31 | Docker sandboxes | Separate `sandbox-runner`, gVisor, socket proxy |
| Q32 | Sign-up | First user is admin, then invite-only; domain and SSO options |
| Q33 | Web search | Provider-native when available, otherwise our tool (SearXNG default) |
| Q34/Q36 | Memory | Markdown file per user; auto-apply with versions and undo; the agent mentions it inline |
| Q35 | Evals | All three layers, phased |
| Q37 | Eval tooling | Hybrid: our Postgres for user-facing, OpenTelemetry export for tracing |
| Q38 | Publish gate | Per-library policy; informational by default |
| Q39 | Conversation privacy for scoring | Scores only; content by user opt-in or audit policy |
| Q40 | Defaults | Node 24 runtime, local/S3 storage, AES-GCM secrets, separate artifact origin, in-process parsing, config limits, documented backups, notifications in the Collaboration wave |
| — | Importers | ChatGPT, Claude and LibreChat importers in M1 (assumed; move later if preferred) |
| — | Execution (2026-09-26) | A Wayfinder map in `.wayfinder/` carries execution: destination = the whole plan, with gates; private GitHub repo; one PR per ticket, merged by the loop once CI passes (no branch protection on the free plan); up to 3 agents in parallel |
| — | Config filename (2026-09-26) | `app.config.yaml` (brand-neutral), not `openchat.yaml` |
| — | Composer and performance (2026-09-27) | TipTap (MIT only) composer with a server-rendered shell and lazy editor; composer-first loading per performance.dev/chatgpt (D27) |
| — | Audit fixes (2026-09-26) | pg-boss in-process in `web` from M1; `resource_grant` is the only chat-access authority; per-type permission enums; `lingui extract` gate in M1; 20 dropped details restored from v1 |

---

## 14. Facts checked (2026-09-26)

Checked against npm, GitHub and official docs:
- **AI SDK:**
  - `ai@7.0.116`; `experimental_evaluate` since 7.0.103.
  - `WorkflowAgent` is in `@ai-sdk/workflow`.
  - `ai/test` exports `MockLanguageModelV4` and `Experimental_EvaluationMockModelV4`.
- **Jev:** hosted-only, $0.042 per million input tokens, zero data retention for enterprise only.
- **@pierre:** Apache-2.0; trees is beta; diffs merge-conflict support is experimental.
- **Agentation:** PolyForm Shield 1.0.0 (forbids competing use).
- **Blume:** 2.0.3 (MIT, shipped 2026-09-24).
- **TanStack Hotkeys:** 0.12, alpha.
- **Better Auth:** 1.7.6, with the Electron, Expo and OAuth-provider plugins.
- **Expo:** 57.0.25 (React 19.2.3, RN 0.86.3).
- **shadcn:** 4.21.0. It has `--base base|radix|aria`, `--preset`, `--rtl` and `apply`. `iconLibrary` supports lucide, tabler, hugeicons, phosphor and remixicon. The install-time `IconPlaceholder` produces hard imports.
- **AI Elements:** Radix-only; imports lucide directly.
- **just-bash** 3.4.2 and **bash-tool** 1.3.19.
- **Daytona:** closed-source since June 2026.
- **Mastra:** 1.71; RBAC and SSO in Studio need the EE licence.
- **LibreChat:** v0.8.8-rc4; Discussion #3985 (not Postgres-specific).
- **Drizzle:** 0.45.3 stable, 1.0.0-rc.
- **pg-boss:** 12.
- **Lingui:** 6.8.
- **Microsandbox:** 0.7.4 (beta).
- **Material Symbols:** `@material-symbols/svg-*` 0.47.5 (Apache-2.0).
- **Evalite:** 0.19.
- **Langfuse:** the JS SDK is now `@langfuse/tracing` + `@langfuse/otel`.
- **Name:** "openchat" collides with ICP OpenChat (oc.app), imoneoi/openchat and opencx OpenChat. The `@openchat` npm scope is taken.
