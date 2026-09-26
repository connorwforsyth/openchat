# @workspace/contract

The API every client builds against (PLAN.md D26): zod schemas for the data,
an oRPC contract for the procedures, and the OpenAPI 3.1 document generated
from both. Frozen for the M1 workstreams; changes follow the process at the
end of this file.

## What's in it

| Import | What |
|---|---|
| `@workspace/contract/contract` | `contract`: every procedure, grouped by domain. Handlers implement it (`implement(contract)` in `@workspace/server`); `@workspace/client` types its client from it. |
| `@workspace/contract/errors` | Typed error maps and `errorCodeSchema`. |
| `@workspace/contract/schemas/<domain>` | The zod schemas and `z.infer` types, below. |
| `@workspace/contract/fixtures` | Valid sample data for every major type, with fixed ids, for tests and UI work before the server exists. |
| `@workspace/contract/openapi` | `generateOpenApi()`. |
| `openapi.json` | The generated document (committed). |

Schemas, by file:

| File | Holds |
|---|---|
| `common` | Branded UUIDv7 ids per entity, timestamps, micro-USD, JSON values, cursor pages. |
| `message-parts` | `MessagePart` (text, reasoning, file, source, tool-call with approval state, tool-result, artifact-ref, annotation-ref, data, step-start), `PARTS_VERSION`, approval decisions with per-hunk review. |
| `messages` | `Message`, the tree (`MessageNode`, `MessageTree`), `BranchPath` and `SiblingInfo` for the branch switcher. |
| `runs` | `RunStatus` and `RunState` (one variant per status), `Run`, run input and targets, `createRun` in/out (`{ runId, streamUrl }`), approvals, `StreamCursor`, `StreamChunk`. |
| `conversations` | `Conversation` with its chat context and lock, visibility, participants' per-user state. |
| `tenancy` | Orgs, members, invitations, the team tree, `Principal`, `ChatContext`, `OrgPolicy` and the instance limits it's clamped to. |
| `grants` | `ResourceGrant`: a union keyed by `resourceType`, so chats take `viewer | editor` and library items take `use | view | edit`. Share links. |
| `library` | Agents, prompts, skills, MCP servers and presets: definitions per kind, items, versions (draft and published), listing tabs, share-vs-publish inputs, import/export, MCP connection status. |
| `files` | Files and ingestion status, file search, artifacts and their versions. |
| `memory` | The memory document, versions, `MemoryPatch` and the `update_memory` tool input. |
| `feedback`, `keys`, `usage` | Thumbs feedback; provider keys (write-only secrets, scopes); transactions, summaries and budgets. |
| `decider` | Decider questions, answers, state and the `decision_log` entry. The port itself is in `@workspace/ai`. |
| `sandbox`, `search`, `meta`, `models` | Sandbox records and exec shapes; chat search and web search results; `me`, public config, model refs and picker options. |

Procedure groups: `conversations`, `messages`, `runs`, `library`, `mcp`,
`orgs`, `teams`, `grants`, `shareLinks`, `files`, `artifacts`, `memory`,
`feedback`, `keys`, `usage`, `sandbox`, `search`, `decisions`, `me`, `meta`.
Every procedure has a REST route under `/api`, a summary and one OpenAPI tag.

## Conventions

- **Ids** are UUIDv7 (`@workspace/shared/ids`): sortable, and branded per
  kind in TypeScript so a `MessageId` can't be passed as a `RunId`.
- **Times** are ISO 8601 strings; **money** is integer micro-USD.
- **Lists** are cursor pages: `{ items, nextCursor }`.
- **Errors** are typed. Every authenticated procedure can return
  `UNAUTHORIZED`, `FORBIDDEN`, `NOT_FOUND`, `VALIDATION` (a domain rule the
  schema can't express) and `RATE_LIMITED`; some add `CONFLICT` (with a
  `reason`), `BUDGET_EXCEEDED`, `PROVIDER_UNAVAILABLE` or
  `FEATURE_DISABLED`. Input that fails a schema is oRPC's `BAD_REQUEST`.
- **GET inputs are flat** so they fit a query string. Numbers and booleans in
  query strings arrive as text; the server's OpenAPI handler coerces them with
  oRPC's smart-coercion plugin, so schemas stay plain `z.int()` and
  `z.boolean()`.
- **Secrets** (provider keys, MCP header values) are write-only: accepted on
  input, never returned.

## The run stream (not a procedure)

`GET /api/runs/{id}/stream` is Server-Sent Events in the **AI SDK UI message
stream protocol** (header `x-vercel-ai-ui-message-stream: v1`), because that's
what `useChat` and a small Swift parser consume. It isn't an oRPC procedure,
so it's added to `openapi.json` by hand (`openapi.ts`) as a
`text/event-stream` operation, `runs.stream`.

- Each event's `data` is one JSON `UIMessageChunk`; its `id` is the chunk's
  sequence number (`StreamChunk.seq`, from 1). The stream ends with
  `data: [DONE]`.
- Resume with `?cursor=<last id>` or the `Last-Event-ID` header: the server
  replays everything after it, then follows live. A finished run replays and
  closes. `cursor=0` (or none) starts from the beginning.
- The server reads from the `StreamChannel` port
  (`@workspace/server/ports/stream-channel`); the `RunExecutor` port
  (`@workspace/ai/ports/run-executor`) writes to it.
- Chunks are opaque JSON in this contract (`jsonValueSchema`) so it doesn't pin
  an AI SDK version. When a run finishes, its output is stored as our own
  `MessagePart`s, versioned by `partsVersion`.

Streaming routes set `runtime = "nodejs"`, `dynamic = "force-dynamic"` and
`X-Accel-Buffering: no` (docs/decisions/0004).

## OpenAPI

```sh
bun run openapi:generate   # rewrite openapi.json from the contract
bun run lint:openapi       # Redocly lint (also part of `lint`)
```

`openapi.json` is committed rather than built: a contract PR then shows its
wire-level diff for review, and Swift, Scalar and the docs site can read it
without running TypeScript. A test fails when the committed file is stale.
Shared shapes are named `components.schemas` (`Message`, `Run`,
`ResourceGrant`, one `<CODE>Error` per error code, …) so generated clients
get real type names.

## Changing the contract

The contract and the port interfaces in `packages/*/src/ports/` are what
parallel work builds against (PLAN.md §3, AGENTS.md "Contract changes"):

1. Open a **separate PR** that touches only `packages/contract` (or only the
   port files). Say who needs the change and what breaks.
2. Run `bun run openapi:generate` and commit `openapi.json` with it.
3. Add or update round-trip cases in `src/schemas/schemas.test.ts` (a test
   fails if an exported schema has none) and fixtures if a shape changed.
4. Changing a stored shape (`MessagePart`) means bumping `PARTS_VERSION` and
   writing a migration for existing rows.
5. The owner reviews and merges it. Agents never merge contract PRs; until it
   lands, build against the current contract, or stop and report if blocked.
