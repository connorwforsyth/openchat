---
id: "102"
title: "Get a run ready while the person types, so Send starts streaming sooner"
labels: [wayfinder:build]
status: open
assignee: loop
blockedBy: []
---

## Question

From performance.dev/chatgpt (Connor, 2026-10-01): ChatGPT completes its pre-send work while the person types, so submission feels instant. Our first token is about 850ms median in e2e (`e2e/support/timings.ts`). Some of that is work that doesn't depend on the final text: resolving the model and key, making sure the chat's workspace is up (`ensureWorkspace`), and loading the agent, tools and MCP connections.

## Done when

- **Measure first:** break first-token latency down into phases (create the chat, resolve the model and key, workspace, the retrieval gate/Decider, tool and MCP setup, provider time to first byte), with server timing marks, and record the baseline in the ticket.
- **Warm while typing:** once the composer has text (debounced; not on every key), the client asks the server to warm the chat's turn: resolve the target and key, ensure the workspace, connect MCP servers, load the agent version. All of it is cached briefly (about 60s) per conversation, target and user, so the run reuses it.
  - Prefer an existing endpoint. If a new route is unavoidable, it is one additive, read-only "prepare" route; stop and report before adding it.
- **No side effects:** warming creates nothing the person can see. A new chat isn't created until Send; its id is generated client-side (UUIDv7, D28). Warming never spends tokens or calls a model, and the Decider still runs on the final text.
- **Cancelled or changed:** if the person changes the target, or the context changes, the warm-up is discarded.
- **Result:** first-token median improves measurably in e2e (report before and after), with no change in behaviour.
- Gate and e2e pass.

## Owns

`packages/server/src/runs/**` (turn resolution and caching only), `packages/chat-ui/src/chat/**` (the warm-up trigger), `packages/client/src/**`, `e2e/support/timings.ts`, tests.

## Results (2026-10-01, loop)

**Measured first; the warm-up is not built.** The measurements say the work
the warm-up would move is a few milliseconds, and warming needs a new
contract route, which waits for Connor (see "Blocked" below).

### How it's measured

- **Server marks** (`packages/server/src/runs/timing.ts`): each run marks the
  end of each phase through an optional `RunTimings` sink (`services.timings`).
  `RUN_TIMINGS_FILE` appends them as JSON lines; with it unset (production)
  nothing is recorded. `e2e/support/serve.ts` sets it.
- **Client phases** (`e2e/support/timings.ts`): the measured sends time their
  API requests from the Enter keydown (when each was made, when its headers
  came back). `print-timings.ts` prints both after the run.

### Baseline

`chat.spec.ts` "a new chat streams a reply…", 7 runs on one server build,
load average 7–14 (other agents running). Medians, ms.

| From the Enter keydown (client) | new chat | second turn |
|---|---:|---:|
| `POST /conversations` done (create the chat) | 20 | – |
| `POST /runs` sent (after routing to `/c/[id]`) | 37 | 5 |
| `POST /runs` done | 68 | 24 |
| stream requested | 73 | 27 |
| stream headers | 137 | 78 |
| **first token on screen** | **169** | **88** |

| Server phase (each since the one before) | new chat | second turn |
|---|---:|---:|
| `run.checked`: conversation, access, target, context, budget | 4.8 | 2.6 |
| `run.placed`: user message + run stored | 11.4 | 4.6 |
| `run.started`: executor claim (empty answer) | 4.9 | 3.6 |
| `turn.branch`: load the branch | 3.8 | 2.7 |
| `turn.model`: resolve the model and key | 1.6 | 0.6 |
| `turn.gate`: attachment probe + retrieval gate (Decider off in e2e) | 2.0 | 1.4 |
| `turn.workspace`: workspace tools (the workspace starts lazily) | 1.8 | 0.5 |
| `turn.mentions`: `@file` mentions | 0.7 | 0.4 |
| `turn.resolved`: chat memory, resolver returns | 4.9 | 3.7 |
| `agent.called`: attachments, `runAgent` started | 5.5 | 2.2 |
| `agent.first-text`: provider time to first text | 59.9 | 11.0 |
| **`POST /runs` arrived → first text** | **101** | **32** |
| `POST /runs` arrived → client's stream opened (parallel path) | 90 | 66 |

Agent turns add `turn.agent` (version load) and `turn.tools` (tool plan,
MCP connect); the e2e chat test has neither.

### What the numbers say

- **What the warm-up would save is about 4 ms of a new chat's 169 and 1.5 ms
  of a second turn's 88**: model and key, workspace binding and memory are all
  small. In e2e there are no MCP servers or agents, the key store is the
  in-memory instance one, and the workspace is lazy, so nothing slow is there
  to warm. It would only show up in production: agents with MCP servers
  connecting after the 15-minute idle close, keys from the database with org
  policy, and remote sandboxes attaching. The e2e suite can't show any of that.
- **Where the time actually goes:**
  1. **Second turn: the stream connection.** The run has its first text
     32 ms after `POST /runs` arrives, but the client's stream request only
     passes its checks 66 ms after it. Two things cause this: the stream is
     requested only after `POST /runs` returns (a serial round trip), and the
     stream route's session, run and access lookups appear to wait behind the
     run's own writes on the embedded single-connection PGlite. A
     finer-grained probe saw the session lookup alone take about 25 ms.
  2. **New chat: everything before the run starts.** The client creates the
     conversation (20 ms) and routes to `/c/[id]` (17 ms) before it sends
     `POST /runs`. The new page's data batch (7 queries plus RSC) then
     competes with the run.
  3. **New chat: a cold first provider call.** The first run in a fresh
     server process waits about 60 ms for its first text, against 11 ms after
     that. With a warm-up run first, the measured new chat dropped to a median
     of 152 ms (3 runs). It's probably the first HTTP connection and code
     path to the provider, which a warm-up that never calls a model likely
     can't reach. Not confirmed.
- The ~850 ms quoted in the question was measured under heavy machine load.
  On a quiet machine every phase is far smaller, but the proportions hold.

### Blocked: the warm-up needs a contract route

No existing procedure fits. A warm-up has to name the conversation (or the
draft context, for a new chat) and the target, and run the same access
checks as `runs.create`. The GETs the chat page already makes (`runs.list`,
`sandbox.get`, `conversations.get`) take no target, and adding warm-up side
effects to them would change what they mean. The route would be:

- `runs.prepare`: `POST /runs/prepare`, additive and read-only, 204 No
  Content, in its own contract PR.
  - Input: `createRunInputSchema.pick({ context, options, target })`, plus
    an optional `conversationId`. A new chat has no id until Send (a
    client-side id needs `createConversationInput.id`, which is a contract
    change of its own).
  - Errors: `NOT_FOUND` exactly where `runs.create` returns it (the
    conversation, an agent the caller may not use, a draft they may not
    edit).
- The server would cache, for about 60 s per user + conversation (or
  context) + target: the resolved model and key, the agent version, MCP
  connections and an attached workspace. It would never create one: a new
  workspace is visible in the Files panel. The cache entry is dropped when
  the target or context changes, and the run takes it once. Approvals,
  permissions and what the model receives stay the same.

Expected effect in e2e: about 4 ms, within noise, so it wouldn't meet "first
token improves measurably". Bigger wins would come from (1) opening the
stream with the run instead of after it, (2) starting a new chat's run
without waiting for client routing, and (3) taking the stream route's
lookups off the run's path. Those are outside this ticket's Owns, and (1)
probably means a contract change too.
