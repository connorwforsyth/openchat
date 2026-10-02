# T3 Code server and runtime architecture compared with openchat

## 1. What T3 Code's server is

T3 Code is a local or remote server for a single owner. It wraps provider CLIs (Codex, Claude Code, Cursor, OpenCode, Grok, Antigravity) as subprocesses and serves web, desktop and mobile clients over one WebSocket RPC. Its stack:

- **Effect 4** for services, layers, tagged errors and Schema (`effect/unstable/rpc`, `effect/unstable/sql`).
- **SQLite** at `~/.t3/userdata/state.sqlite`.
- **A full CQRS and event-sourcing core.** `AGENTS.md` "How it works" and `docs/internals/overview.md` are the best orientation.

### Effect conventions (`docs/internals/effect-services.md`)

- **Every capability is a method on a `Context.Service`.** Transports (the `ws.ts` RPC handler, HTTP routes, MCP tools, the CLI) only decode the input, call one service method and map its errors. The stated reason is reach: users, agents over MCP and scheduled jobs all hit the same method.
- **Errors are `Schema.TaggedError` classes.** They carry structured fields and a `cause`. The message is fixed or built from fields, never from `cause`. A service error is mapped to a transport error only in the transport.
- **Module shape:** errors and schemas, then the `Context.Service` tag with its interface inline, then `make`, then `layer`. Consumers import the module as a namespace. Dependencies come from the environment (`yield* FileSystem.FileSystem`).

### Contracts and versioning (`packages/contracts`)

- All wire types are Effect Schema. `rpc.ts` (1.6k lines) defines `WS_METHODS` plus `Rpc.make(..., { stream: true })` subscriptions, serialised as JSON (`RpcSerialization.layerJson`, `ws.ts:4151`).
- Versioning has two parts:
  - one global `ORCHESTRATION_PROTOCOL_VERSION = 1` query parameter (`environment.ts:13`);
  - many optional capability flags on the environment descriptor (`threadSettlement`, `fileAttachments.maxUploadBytes`, `pullRequests`, and so on, at `environment.ts:95-160`). Clients treat a missing flag as unsupported.
- Rule (`overview.md` "Durable intent"): persisted events must stay decodable on replay. Fields get `withDecodingDefault` or `optionalKey` so that old stored events and old servers' cached snapshots still decode (for example `orchestration.ts:551`, `:1919`).

## 2. Persistence: event sourcing with projections

- **Event log.** `orchestration_events` holds a global `sequence`, a per-stream `stream_version`, `command_id`, causation and correlation ids, and JSON payloads (`persistence/Migrations/001_OrchestrationEvents.ts`).
- **Idempotent retries.** `orchestration_command_receipts` keys on `command_id` and stores `accepted` or `rejected` plus the result sequence (`002`).
- **Projections.** The read model lives in `projection_*` tables: threads, turns, messages, activities, pending approvals, sessions (`005` through `054`). There are 54 migrations, mostly projection columns, backfills and repairs. Migrations are imported statically and run by `Migrator.fromRecord` at boot (`persistence/Migrations.ts`).
- **Engine** (`orchestration/Layers/OrchestrationEngine.ts`):
  - one unbounded command `Queue` serialises every command;
  - a pure `decideOrchestrationCommand` (`decider.ts`, 2.2k lines) produces events;
  - in one SQL transaction it appends the events, applies the projections and upserts the receipt;
  - only after commit does it update an in-memory `commandReadModel` and publish to a `PubSub`.
  - On failure it re-reads events from the dispatch start sequence to reconcile.
- **Reactors** (`ProviderCommandReactor`, `CheckpointReactor`, `ThreadDeletionReactor`, `PullRequestSyncReactor`) do the side effects after commit and feed results back as commands. A command acknowledgement means "intent committed", not "work done".
- **Provider resume state.** `provider_session_runtime` stores `resume_cursor_json` and `runtime_payload_json` per thread (`004`).

## 3. WebSocket protocol: keeping payloads small

This is the area most worth studying.

1. **A shell stream and a detail stream.**
   - `subscribeShell` streams sidebar-sized `thread-upserted`, `thread-removed` and `project-*` upserts.
   - `subscribeThread` streams one thread's events.
   - A client viewing one thread never pays for the others (`orchestration.ts:946-1035`).
2. **Snapshot over HTTP, deltas over the socket.**
   - The client fetches the snapshot over HTTP (gzip, `snapshotSequence`), then subscribes with `afterSequence`.
   - The server replays persisted events after that sequence, then goes live.
   - It falls back to a snapshot frame if the gap exceeds `THREAD_RESUME_MAX_EVENTS = 1000` or `ORCHESTRATION_REPLAY_PAYLOAD_BUDGET_BYTES = 8 MiB` (`ws.ts:381-385`, `:2495-2549`).
   - Overlap is deduped by sequence on the client.
   - The optional `requestCompletionMarker` emits `{kind:"synchronized"}` between catch-up and live, so the UI knows when it is current.
3. **Ordering rule.** The live subscription is forked into a buffer before the snapshot or replay is read, otherwise events published during the read are lost (comment at `ws.ts:2462-2493`).
4. **Wire projection.** `ActivityPayloadProjection.projectActivityPayload` keeps full tool payloads in the database but strips every field no client reads before sending (MCP envelopes summarised, changed files capped at 12, and so on). It is applied to both snapshots and live events (`orchestration/ActivityPayloadProjection.ts:420+`, `ws.ts:2457`).
5. **Coalescing.**
   - `ThreadLiveEventCoalescer` uses a 50 ms window and keeps only the latest `tool.updated` per `(turnId, toolCallId)` (`orchestration/ThreadLiveEventCoalescer.ts`).
   - Assistant text is buffered server-side in "paragraph" mode. `splitBufferedAssistantText` releases text only at markdown block boundaries outside open code fences, with at most one delivery per 400 ms and a 24k-character safety valve (`ProviderRuntimeIngestion.ts:117-122`, `:222`). Each flushed chunk becomes one `thread.message.assistant.delta` event, not one per token. A "token" mode exists per project.
6. **Backpressure.**
   - `LiveStreamBudget` gives each subscription a budget of 1,000 items or 8 MiB, counting the batch awaiting the client's RPC acknowledgement.
   - Each payload is sized once through a `WeakMap`.
   - On overflow it fails with "Resume from the last received sequence" and the client resubscribes with `afterSequence` (`orchestration/LiveStreamBudget.ts`).
7. **Windowed history.**
   - `turnLimit` returns the last N user turns.
   - The opaque base64url cursor embeds `threadId`, an anchor timestamp and `turnId`. It deliberately avoids row ids, which projection rebuilds rewrite (`orchestration/threadDetailCursor.ts`).
   - A per-thread `threadSequence` watermark stops an older page from double-applying deltas (`orchestration.ts:1061-1072`).
8. **Measured budgets as tests.** `integration/TransferBudgetScenario.integration.ts` and `NetworkTransferMeasurement.integration.ts` seed 10 turns with 900 KB MCP results through a replay adapter, then measure real HTTP (gzip) and WebSocket wire bytes. `server.test.ts:13244` ("reports thread HTTP and WebSocket transfer budgets") writes a report.

The reconnect policy lives client-side in one supervisor per environment (`packages/client-runtime/src/connection/supervisor.ts`, described in `docs/internals/connection-runtime.md`):

- capped backoff;
- offline and auth failures wait for a wake-up instead of retrying;
- foreground events probe the existing socket before replacing it;
- mutations are never auto-replayed.

## 4. Providers, approvals, interrupts, resume

- **`ProviderAdapterShape`** (`provider/Services/ProviderAdapter.ts`) has `startSession`, `sendTurn`, `interruptTurn`, `respondToRequest`, `respondToUserInput`, `stopSession`, `readThread`, `rollbackThread`, an optional `compaction` (native or slash-command), and `streamEvents: Stream<ProviderRuntimeEvent>`.
- **Declared capabilities:** `sessionModelSwitch`, `promptlessTurnContinuation` and `supportsConversationRollback`. A revert is refused before files are touched if the provider can't roll back (`docs/internals/providers.md` "Protocol traps").
- **Normalised runtime events** (`contracts/src/providerRuntime.ts`): about 50 types (`turn.*`, `item.*`, `content.delta`, `request.opened/resolved`, `user-input.*`, and so on) with canonical item and request types. Each keeps a `raw` field naming the native source for debugging. `ProviderRuntimeIngestion` turns them into orchestration commands.
- **Restart handling** (`serverRuntimeStartup.ts:405-481`, tests in `serverRuntimeStartup.reconcile.test.ts`):
  - `markRunningProviderSessionsForContinuation` runs before a self-update;
  - `reconcileProviderSessions` at boot resumes sessions that have a resume cursor ("Continue where you left off.") and settles the rest as orphaned;
  - a `makeCommandGate` holds commands until startup completes.
- **Idle reaping:** `ProviderSessionReaper` stops sessions idle for 30 minutes, sweeping every 5 minutes.
- **`packages/effect-acp` and `packages/effect-codex-app-server`** are typed JSON-RPC-over-stdio clients whose schemas are generated from upstream specs (`scripts/generate.ts` → `src/_generated/*.gen.ts`).

## 5. Checkpoints, MCP, terminals, scheduled tasks

- **Checkpoints** are hidden Git refs under `refs/t3/checkpoints`, captured with a temporary index so the user's branch and staging area are untouched (`checkpointing/CheckpointStore.ts`, `Utils.ts:4`). Turn diffs are cached in `checkpoint_diff_blobs(thread_id, from_turn_count, to_turn_count)`. "Turn ended" and "checkpoint settled" are separate milestones, so a late diff never stretches a turn's recorded duration.
- **MCP exposure.** The server runs its own HTTP MCP server for the agents it hosts (`mcp/McpHttpServer.ts`).
  - `McpSessionRegistry` issues per-provider-session tokens (stored hashed). Each token is scoped to a thread and a capability set (`preview | device | pull-requests`).
  - Tokens are revoked on session or thread end and kept alive by `touch` during turns.
  - Tools are Effect `Toolkit`s whose handlers call the same orchestration services (`mcp/toolkits/pullRequests/tools.ts`, `McpInvocationContext.requireMcpCapability`).
- **Terminals** (`docs/internals/terminal-runtime.md`): the server owns the PTYs. Live events carry only new chunks. History is capped at 5,000 lines or 8 MiB, and restore reads only the tail.
- **Scheduled tasks:** `AGENTS.md` mentions them, but I found no scheduler in this checkout. Only the principle that capabilities must be service methods is there.

## 6. Testing

- **Integration harness:** `integration/OrchestrationEngineHarness.integration.ts` plus `TestProviderAdapter.integration.ts`, a scripted adapter that replays fixture `ProviderRuntimeEvent`s and can mutate the workspace per turn.
- **Fixtures** live in `integration/fixtures/`. Codex wire tests use a mock peer process (`provider/testFixtures/codexCollabMockPeer.mjs`).
- **No sleeps.** `DrainableWorker` (`packages/shared/src/DrainableWorker.ts`) exposes `drain`, which waits for "queue empty and current item done", and `KeyedCoalescingWorker.drainKey` does the same per key. `RuntimeReceiptBus` publishes test-only milestones (`checkpoint.diff.finalized`, `turn.processing.quiesced`) and is a no-op in production.
- **Other tooling:** `SqlStatementCounter.integration.ts` counts queries. Tests use `@effect/vitest`'s `it.effect`.

## 7. openchat today (for the comparison)

- **Runs.** `run` rows carry a status union (`runs/state.ts`), and an in-process executor (`runs/executor.ts`) runs the AI SDK loop.
- **Stream.** `StreamChannel` (`ports/stream-channel.ts`) is backed by Postgres `run_chunk` rows (one opaque `UIMessageChunk` per row) with LISTEN/NOTIFY plus a polling fallback (`stream/postgres-stream-channel.ts`). Writes are batched per transaction.
- **SSE.** `GET /runs/:id/stream?cursor=` sends `id = seq`, a 15 s heartbeat, then `[DONE]` (`stream/sse.ts`). The client reconnects with backoff of 250 ms up to 5 s (`packages/client/src/run-stream.ts`).
- **Pruning.** Chunks are pruned after completion by the `run.prune` job (`jobs/registry.ts`).
- **Creating a run is already idempotent** (`idempotencyKey`, `contract/src/schemas/runs.ts:276`, `create-run.ts:314`).
- **Boot recovery** marks every `running` run as failed (`executor.ts:1129`, called from `server.ts:498`).
- **No conversation-level live channel yet** (D25 plans `GET /conversations/:id/events`).
- **Version signal:** only config `features` (`contract/src/schemas/meta.ts:97`) plus `partsVersion` on messages.
- **Output caps:** sandbox output is capped at 256k characters (`packages/sandbox/src/output.ts`). I found no cap on MCP tool results in `packages/mcp/src`.

## 8. Recommendations, ranked by value

**1. Wire projection, output caps and transfer-budget tests (high).**
- T3: tool payloads are stored in full but projected down for the wire (`ActivityPayloadProjection.ts`), and the projection is enforced by measured budget tests (`integration/TransferBudget*`).
- openchat: every `tool-output-available` chunk, including uncapped MCP results, goes into `run_chunk` and over SSE. A resume from cursor 0 replays all of it.
- Adopt:
  - cap MCP results the way `capOutput` caps sandbox output;
  - add a pure `projectChunkForWire` in the SSE path that summarises large tool outputs, with full output fetched on demand by toolCallId;
  - add a PGlite plus `MockLanguageModelV4` test that asserts bytes over SSE for a 10-turn chat with large tool results.

**2. Coalesce text deltas before persisting (high, cheap).**
- T3: paragraph-boundary buffering (`ProviderRuntimeIngestion.ts:222`, 400 ms) and latest-wins coalescing of tool updates (`ThreadLiveEventCoalescer.ts`).
- openchat: writes one row per `text-delta` and `reasoning-delta` chunk.
- Adopt in `postgres-stream-channel.ts` `writeBatch`: merge adjacent deltas with the same `id` within a batch into one chunk. The AI SDK protocol stays the same; there are far fewer rows and NOTIFYs; and D28's "throttle to animation frames" gets cheaper. Paragraph mode is optional. Don't make it the default for chat, where token feel matters.

**3. Shell/detail split and `afterSequence` resume for the D25 events channel (high when the Collaboration wave lands).**
- T3: `subscribeShell` and `subscribeThread` with `afterSequence`, a bounded replay that falls back to a snapshot, a `synchronized` marker, and the live stream attached before the snapshot is read (`ws.ts:2440-2600`, `orchestration.ts:977-1035`).
- openchat: has resume only per run. Conversation and sidebar freshness depends on Query invalidation.
- Adopt for `GET /conversations/:id/events` and a user-level sidebar stream:
  - a per-conversation (or per-user) monotonically increasing sequence on a small `conversation_event` table, pruned like `run_chunk`;
  - HTTP snapshot with `snapshotSequence`, then SSE `?after=` and `Last-Event-ID`;
  - a `{type:"synchronized"}` event;
  - snapshot fallback when the gap exceeds N events or bytes.
- This fits the persisted TanStack cache in D28: a cached list plus `afterSequence`, rather than a full refetch.

**4. Executor leases and continue-after-restart (high before `apps/worker` or multiple web replicas).**
- T3: `serverRuntimeStartup.ts` reconcile and continuation markers, with a test per scenario.
- openchat: `recover()` fails every `running` row at boot. With two processes, a booting replica would kill the other one's live runs.
- Adopt:
  - an `executorId` plus `heartbeatAt` lease on `run`, and recover only expired leases;
  - optionally, an opt-in "continue" that re-queues an interrupted run with its persisted partial parts instead of failing it, like T3's `threadRestartContinuation` capability.

**5. Drainable executors instead of sleeps (medium, cheap).**
- T3: `DrainableWorker.drain`, `KeyedCoalescingWorker.drainKey`, and the test-only receipt bus.
- openchat: `runs/harness-reliability.test.ts` uses `vi.waitFor` with `setTimeout(…, 50)`. The executor already tracks a `running` map (`executor.ts:368`).
- Adopt: expose `idle(): Promise<void>` on `InProcessExecutor` and `drain()` on `MemoryJobQueue`, and wait on those in tests.

**6. Capability flags for independently upgraded clients (medium).**
- T3: optional booleans on the descriptor; missing means unsupported; legacy fields stay emitted (`environment.ts:95-160`, `overview.md` "Pull request linking compatibility").
- openchat: desktop, a future Swift client and self-hosted servers will skew versions.
- Adopt: a `capabilities` object in `meta` (wire features, not product flags) and a `protocolVersion`.
- Also adopt the rule that stored data must decode on replay: add fixture tests that decode old `MessagePart` JSON at every `partsVersion`.

**7. Per-turn workspace checkpoints with hidden Git refs (medium, for D7 cowork and D16 diffs).**
- T3: temporary-index capture to `refs/t3/checkpoints/*` plus a cached diff table (`CheckpointStore.ts`, migration `003`), with turn completion kept separate from checkpoint settlement.
- openchat: sandboxes have only whole-sandbox `snapshot()` (`packages/sandbox/src/ports/sandbox.ts:72`). Desktop cowork has no checkpointing yet.
- Adopt for desktop cowork and Git-backed sandbox workspaces: a "revert turn" and "diff this turn" button without polluting the user's branch.

**8. Declared adapter capabilities (low-medium).**
- T3 adapters declare what they support, and orchestration refuses unsupported operations up front.
- openchat: apply the same pattern to sandbox providers and model capabilities (rollback, snapshot, image input) as data on the port result, instead of `if provider === …` branches.

**9. Scoped MCP credentials if openchat exposes itself to agents (low now).**
- T3: hashed per-session tokens with capability sets, thread binding and liveness revocation (`mcp/McpSessionRegistry.ts`, `McpInvocationContext.ts`). T3 also states the general principle that every capability is a service method reachable from RPC, MCP and jobs.
- openchat: for desktop cowork, or for external Claude Code talking to openchat, issue run-scoped, capability-scoped MCP tokens rather than reusing user sessions. The "thin transport, one service call" rule matches openchat's oRPC handlers plus ports and is worth stating in `AGENTS.md`.

**10. Opaque keyset cursors (low).**
- T3's cursors are scoped to a thread id and never use row ids (`threadDetailCursor.ts`).
- openchat: check that `pageOf(messageSchema)` cursors don't embed row ids that a fork or move could rewrite.

## 9. What openchat should not copy

- **Effect itself.** It conflicts with D8 (zod first, `Result`, ports as function arguments, no DI container). T3's `Context.Service` and `Layer` are a service locator by another name, and parts of its stack are `effect/unstable/*`. Take the ideas (tagged errors with fixed messages, thin transports), not the runtime.
- **Full event sourcing with an in-memory read model.**
  - `OrchestrationEngine` keeps every project and thread in one process's memory (`commandReadModel`) and serialises every command through one global queue. That is fine for one owner on SQLite; it is wrong for a multi-user Postgres deployment with several processes.
  - It also costs a lot: 54 migrations of mostly projection columns and backfills, and replay-compatibility hazards (`providers.md` "Attachments and stored history": one undecodable event can fail the whole environment's startup).
  - openchat's state rows, run status union, idempotency key and prunable `run_chunk` are the right size. If the conversation events channel needs a sequence, make it a notification log, not the source of truth.
- **Keeping every streamed delta forever.** T3 persists deltas as permanent domain events. openchat stores final `parts` and prunes chunks; keep that.
- **WebSocket as the only transport.** WebSockets need sticky sessions or a pub/sub layer behind load balancers and are awkward in Next route handlers (D26). SSE plus Postgres NOTIFY already resumes by cursor. Take the protocol ideas (snapshot, then `afterSequence`, budgets) onto SSE.
- **Provider-CLI machinery.** Subprocess adapters, provider install and update runners, account-profile isolation, ACP and codex-app-server clients, resume cursors for native sessions, and the session reaper all exist because T3 wraps external agent runtimes. openchat owns its loop through the AI SDK, and `UIMessageChunk` is already its normalised event union.
- **Single-owner assumptions.** Environment-local settings, pairing and tunnels, `~/.t3` home directories, and "a socket is authenticated, so authorise every method" (T3 adds scopes on top) do not fit a multi-tenant server where `resource_grant` must be checked on every subscription.

Note: T3's own `AGENTS.md` rule ("Do not introduce machinery because it looks architecturally impressive") argues for the same filter. Adopt items 1, 2, 4 and 5 now; adopt 3 and 6 with the Collaboration wave; adopt 7 with desktop cowork.
