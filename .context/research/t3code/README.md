# T3 Code study (2026-10-03)

T3 Code (`pingdotgg/t3code`, commit `54084ae1`, 2026-10-01) is an open-source GUI
for coding agents: a Node WebSocket server wrapping provider CLIs (Codex, Claude
Code, Cursor, OpenCode…), with web, Electron and Expo clients and 400k users.
Five sub-agents read it against openchat, one area each, without editing either
repo. Their full reports, with `t3:` and `oc:` file paths, are beside this file.

To re-read the source: `git clone --depth 1 https://github.com/pingdotgg/t3code /tmp/study/t3code`.

| Report | Area |
|---|---|
| [server.md](server.md) | server, WebSocket protocol, persistence, providers, testing |
| [web.md](web.md) | web client, rendering performance, composer, palette, tests |
| [desktop.md](desktop.md) | Electron app, updates, packaging, native helpers |
| [remote-mobile.md](remote-mobile.md) | pairing and auth, relay, mobile app, shared client runtime |
| [engineering.md](engineering.md) | AGENTS.md, lint rules, knip, ports and worktrees, CI |

## The short version

T3 Code is the same shape of product from the other end: a **single-owner**
server that wraps **other people's agent loops**, where openchat is a
**multi-user** server that runs **its own** loop through the AI SDK. So its
event-sourced core, provider-CLI adapters, pairing/relay/tunnels and Effect
service layers don't transfer (and its own AGENTS.md warns against "machinery
because it looks architecturally impressive"). What transfers is how hard it
works at three things openchat also cares about:

1. **What crosses the wire.** Tool payloads stored in full but projected down
   for clients; deltas coalesced before they're persisted; replay bounded by
   count and bytes with a snapshot fallback; measured transfer-budget tests.
2. **How a chat feels while it streams.** Incremental, WASM-engine syntax
   highlighting; drafts that persist; prompt recall; queued follow-ups; scroll
   position remembered per thread; statuses that don't flash.
3. **How many agents can work on the repo at once.** Ports and state derived
   from the worktree path; "ways to hurt yourself" and "hit every surface" in
   AGENTS.md; knip with a ratchet; receipts instead of sleeps in tests.

openchat is already ahead on: i18n, browser-mode and Playwright tests, the
typed shortcut registry, Electron fuses/single-instance/IPC validation/
deny-by-default permissions, the desktop Playwright smoke, row memoisation, and
the persisted query cache.

## In codebase-design terms

- **The run stream is the module with the most leverage to deepen.** Its
  interface (`StreamChannel`: append, follow from a cursor) is small, which is
  right; the depth to add is behind it: coalescing (145), wire projection and
  caps (146), and later bounded replay with a snapshot fallback. Callers
  (executor, SSE route, client) shouldn't change.
- **The client connection is a hypothetical seam today and a real one soon.**
  Web is the only adapter. When desktop's instance shell and the Expo app
  arrive, a `ConnectionSignals` port (network, app-active, credentials) with
  one retry owner per instance becomes a real seam with three adapters. Shape
  `packages/client` for it in the Collaboration wave, not before.
- **Drafts are a missing module.** Today a draft's state is smeared across a
  mounted editor; a `DraftStore` port with a localStorage adapter and an
  in-memory fake (147) gives it locality and a test surface.
- **Executor idleness is the right test seam.** Tests that sleep are testing
  past the interface; an `idle()` on the in-process executor (150) makes the
  interface the test surface.

## Tickets this produced

| Ticket | What | Source |
|---|---|---|
| [140](../../../.wayfinder/tickets/140-worktree-ports-and-build-lock.md) | Ports per worktree; one `next build` per machine | engineering §1, §5 |
| [141](../../../.wayfinder/tickets/141-knip-unused-code.md) | knip, ratcheted | engineering §2 |
| [142](../../../.wayfinder/tickets/142-agents-md-hazards-and-surfaces.md) | AGENTS.md hazards, surface checklist, glossary | engineering §3 |
| [143](../../../.wayfinder/tickets/143-code-highlighting-in-chat.md) | Syntax highlighting in chat, incremental | web 1 |
| [144](../../../.wayfinder/tickets/144-message-response-memo.md) | `MessageResponse` memo swallows the end of a stream (bug) | web 2 |
| [145](../../../.wayfinder/tickets/145-coalesce-stream-deltas.md) | Coalesce deltas before storing run chunks | server 2 |
| [146](../../../.wayfinder/tickets/146-mcp-output-cap-and-wire-budget.md) | Cap MCP results; wire-budget test | server 1 |
| [147](../../../.wayfinder/tickets/147-composer-drafts-and-recall.md) | Persisted drafts; ArrowUp recall | web 4 |
| [148](../../../.wayfinder/tickets/148-desktop-preload-guard.md) | Desktop preload check on Linux CI | desktop 3 |
| [149](../../../.wayfinder/tickets/149-desktop-update-state.md) | Desktop update state, menu, local feed test | desktop 1–2 |
| [150](../../../.wayfinder/tickets/150-drainable-executor.md) | Tests wait on executor idle, not sleeps | server 5 |
| [151](../../../.wayfinder/tickets/151-run-leases.md) | Run leases so boot recovery spares live runs | server 4 |
| [152](../../../.wayfinder/tickets/152-queue-follow-ups.md) | Queue follow-ups while streaming (needs Connor) | web 3 |
| [153](../../../.wayfinder/tickets/153-chat-scroll-memory.md) | Scroll position per chat | web 7 |
| [154](../../../.wayfinder/tickets/154-delayed-status.md) | Statuses that don't flash | web 6 |
| [155](../../../.wayfinder/tickets/155-api-version-and-capabilities.md) | Contract: API version and capabilities | remote 2, server 6 |
| [156](../../../.wayfinder/tickets/156-desktop-title-bar-overlay.md) | Desktop title-bar overlay; zoom-safe inset | desktop 4–5 |
| [157](../../../.wayfinder/tickets/157-stale-chunk-reload.md) | Recover from stale chunks after an upgrade | web 11 |

## Held for later waves (not ticketed yet)

- **Collaboration and always-on** (server §8.3, web 8, remote 1, 5, 7): the
  D25 events channel as a shell stream plus a per-conversation detail stream,
  HTTP snapshot then `afterSequence` resume, a `synchronized` marker, and a
  bounded replay with snapshot fallback; running/unread state in the sidebar
  and a notification when a hidden tab's run finishes; one connection owner
  per instance in `packages/client`; short-lived stream tickets instead of
  bearer tokens in URLs; Expo push with T3's rules (finished, failed, needs
  approval; quiet in the foreground; minimal payload).
- **Mobile and Swift** (remote 3, 4, 6, 8): an offline outbox on the existing
  `idempotencyKey`; EAS variants with a fingerprint runtime version and a
  native-change label in CI; a multi-instance catalog keyed by `instanceId`
  from day one; benchmark a long message list early.
- **Desktop cowork, 120** (desktop §4, server 7): supervise a local loop in a
  `utilityProcess` (keeps the RunAsNode fuse off); per-turn checkpoints as
  hidden Git refs with a temporary index; scoped, run-bound MCP tokens.
- **Engineering, when Actions minutes allow** (engineering §4, §8, §9): one
  required `Check` job over parallel jobs; `no-native-title-tooltip` and
  shadcn's `no-restyle`/`no-unknown-classes` as lint rules; a check for unused
  suppressions; generated third-party licence notices before distribution.

## Deliberately not copied

Effect and its service layers (D8: ports as arguments, no DI container); event
sourcing with an in-memory read model behind one global command queue (wrong
for multi-user Postgres with several processes); WebSocket as the only
transport (SSE plus NOTIFY already resumes by cursor); provider-CLI adapters;
pairing, relay, tunnels and Clerk; whole-thread virtualisation (D27 keeps
find-in-page); `backdrop-filter` glass, `background-position` shimmer and
height animation (D28); 5–10k-line components; jsdom with mocked React hooks;
paid CI runners and code signing services.
