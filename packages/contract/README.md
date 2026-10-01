# @workspace/contract

The API every client builds against (PLAN.md D26): zod schemas for the data,
an oRPC contract for the procedures, and the OpenAPI 3.1 document generated
from both. Frozen for the M1 workstreams; changes follow the process at the
end of this file.

## Changes (2026-10-01, 101)

Link previews for URL sources: each source chip shows the site's favicon and
a card with the page's OG preview. The server fetches the page, so the
reader's browser never contacts a cited site. Connor approved the route
(2026-10-01); nothing else in the contract changed.

| Change | Who needs it | Compatibility |
|---|---|---|
| `linkPreviews.get`: `GET /link-preview?url=` (signed in, http(s) only) → `{ url, finalUrl, title?, description?, siteName?, image?: { url, width?, height?, alt? }, icon?, fetchedAt }`. `image.url` and `icon` are paths on this API (`/api/link-preview/image?src=…`), never third-party URLs. `NOT_FOUND` when there's no preview (blocked address, timeout, not HTML); `FEATURE_DISABLED` when `features.linkPreviews` is off; `RATE_LIMITED` per user. | `Sources` in chat-ui | New procedure and tag (`Link previews`). Old clients are unaffected. |
| `linkPreviews.image`: `GET /link-preview/image?src=<signed>` → the image bytes (raster `image/*` under 2 MB, never SVG) with `nosniff`, a `sandbox` CSP and `same-origin` CORP. Only `src` tokens a preview signed are served, so it isn't an open proxy. | The favicon and card image | New procedure (a detailed output with a file body). |

## Changes (2026-09-29, 055)

The chat's Files workspace: every chat gets one, created silently on first
use, and the composer and panel create, edit, import and delete files in it
(no terminal in the UI). The server (059) and the web app (060) implement it.

| Change | Who needs it | Compatibility |
|---|---|---|
| `sandbox.writeFile`: `POST /conversations/{conversationId}/sandbox/files`, `{ conversationId, path, content, encoding (utf8 by default), ifMatch? }` → `{ path, size, etag }`. `ifMatch: null` only creates (`CONFLICT` `already_exists`); an etag only replaces that version (`CONFLICT` `version_mismatch`); omitted, it overwrites. At most 5 MiB decoded (`SANDBOX_WRITE_MAX_BYTES`; over it is `BAD_REQUEST`). | The panel's editor and `/` file commands | New procedure. The server's `implement(contract)` router needs a handler before it typechecks. |
| `sandbox.importFile`: `POST /conversations/{conversationId}/sandbox/imports`, `{ conversationId, fileId, path? }` → `{ path, size, etag }`. Copies an upload into the workspace; a taken path gets a free name, never a conflict. | Dropping or attaching files into the workspace | New procedure, as above. |
| `sandbox.deleteFile`: `DELETE /conversations/{conversationId}/sandbox/files`, `{ conversationId, path, recursive (false by default) }` → 204. A non-empty directory without `recursive` is `CONFLICT` `not_empty`. The path goes in the body. | Deleting from the file tree | New procedure, as above. |
| `readFile` output has `etag`: the lowercase hex SHA-256 of the file | Saving an edit only over the version that was read | New required output field: the server's `readFile` must compute it. Clients that ignore it are unaffected. |
| The three new routes are keyed by conversation and can answer `FEATURE_DISABLED`; each creates the workspace on first use. `get` stays read-only. | A chat that never pressed "Create sandbox" | Additive. |
| `runOptions.sandbox`: `auto` now means the file tools are on whenever sandboxes are enabled; `on` means the same; `off` withholds them for the turn. `exec` is documented as for the API and tests. | Plain chats getting file tools without a panel click | Documentation only; the schema is unchanged. Before, `auto` only used an existing sandbox. |

## Changes (2026-09-27, 042)

Gaps found wiring the server (038) and the web app (039). All additive
except where noted; the follow-on commit in the same PR wires each one.

| Change | Who needs it | Compatibility |
|---|---|---|
| `Invitation.token` (random, stored hashed, only in `orgs.invite`'s response) and `orgs.acceptInvitation` takes `{ token }` (Q16) | Invite links; an invitation id alone no longer accepts | `acceptInvitation` moved from `POST /invitations/{id}/accept` to `POST /invitations/accept`. `{ id }` still accepted for one release, deprecated. TypeScript callers passing `{ id }` still compile. |
| `usage.setBudget` takes `orgId` | Org admins capping one member's spend in their org | Optional for one release; omitted, it's the principal's own org (a user's personal org), as before. |
| `ENCRYPTION_UNAVAILABLE` (503) on `keys.create` | Settings shows "ask your admin" instead of a generic 503 | New error code; the server already answered 503 here, untyped. |
| `Artifact.latestVersionId` is nullable | The server's artifact row exists before its first version | Clients must handle `null` (no version yet). |
| `meta.health`: `GET /health` (liveness, and `status` for database and jobs readiness; `?ready=true` answers `NOT_READY` 503 when degraded) | Compose healthchecks and load balancers | New public procedure and error code. |
| `OrgPolicy.persistClientCache` (default `true`), instance limit `policies.persistClientCache`, and `Me.persistClientCache` (the effective answer for this user) (D28) | The web app's persisted query cache, turned off for shared machines | New fields with defaults. A client that `PUT`s a policy without the field resets it to `true`. |
| `UserSettings.shortcuts` (Q31) | Recorded shortcuts follow the user across devices | New output field (`{}` when none); optional on update, replaced whole. |

Config (`@workspace/config`, not the contract): `observability.recordContent`
(default `false`, Q28), the local storage default is now `./.data/files`
(git-ignored, beside the embedded database) instead of `./data/files`, and
`policies.persistClientCache` above.

## What's in it

| Import | What |
|---|---|
| `@workspace/contract/contract` | `contract`: every procedure, grouped by domain. Handlers implement it (`implement(contract)` in `@workspace/server`); `@workspace/client` types its client from it. |
| `@workspace/contract/errors` | Typed error maps (including `llmProxyErrors`) and `errorCodeSchema`. |
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
| `llm` | The model proxy: `LlmProxyRequest` (AI SDK call options plus model, chat context and `stream`), `LlmProxyResponse`, stream parts and the stream's `error` part. |
| `feedback`, `keys`, `usage` | Thumbs feedback; provider keys (write-only secrets, scopes); transactions, summaries and budgets. |
| `health` | The `meta.health` report: database and job-queue checks. |
| `decider` | Decider questions, answers, state and the `decision_log` entry. The port itself is in `@workspace/ai`. |
| `link-preview` | `LinkPreview` and the image route's input; the raster types it serves. |
| `sandbox`, `search`, `meta`, `models` | Sandbox records, exec shapes and workspace file writes; chat search and web search results; `me`, public config, model refs and picker options. |

Procedure groups: `conversations`, `messages`, `runs`, `library`, `mcp`,
`orgs`, `teams`, `grants`, `shareLinks`, `files`, `artifacts`, `memory`,
`feedback`, `keys`, `usage`, `sandbox`, `search`, `decisions`, `me`, `meta`,
`linkPreviews`.
Every procedure has a REST route under `/api`, a summary and one OpenAPI tag.

## Conventions

- **Ids** are UUIDv7 (`@workspace/shared/ids`): sortable, and branded per
  kind in TypeScript so a `MessageId` can't be passed as a `RunId`.
- **Times** are ISO 8601 strings; **money** is integer micro-USD.
- **Lists** are cursor pages: `{ items, nextCursor }`.
- **Errors** are typed. Every authenticated procedure can return
  `UNAUTHORIZED`, `FORBIDDEN`, `NOT_FOUND`, `VALIDATION` (a domain rule the
  schema can't express) and `RATE_LIMITED`; some add `CONFLICT` (with a
  `reason`), `BUDGET_EXCEEDED`, `PROVIDER_UNAVAILABLE`,
  `FEATURE_DISABLED`, `ENCRYPTION_UNAVAILABLE` (`keys.create` without an
  `ENCRYPTION_KEY`) or `NOT_READY` (`meta.health?ready=true`). Input that fails a schema is oRPC's `BAD_REQUEST`.
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

## The model proxy (not a procedure)

`POST /api/llm` makes one language-model call with the server's keys, for a
client that runs its own agent loop (desktop cowork, PLAN.md D7). Like the run
stream it's plain HTTP, added to `openapi.json` by hand as `llm.proxy`.

- **The wire is the AI SDK's own.** The body is `LanguageModelV4CallOptions`
  plus `model` (a ref or an alias), `context` (the `ChatContext`: whose keys
  pay and where usage goes, D17) and `stream`. The replies are a
  `LanguageModelV4GenerateResult` (JSON, plus `resolvedModel`) or, with
  `stream: true`, SSE whose `data` is one `LanguageModelV4StreamPart` per
  event, ending with `data: [DONE]`. That's the shape the AI SDK's gateway
  provider sends, so a client wraps the proxy as a custom `LanguageModel`:
  `doGenerate` and `doStream` post their options with the three fields added
  and hand back what comes back.
- Call options the proxy doesn't take (`headers`, `abortSignal`,
  `includeRawChunks`) are dropped when parsed. Only function tools are
  accepted: provider-executed tools would run on the server's keys, and the
  server grants those itself. Binary file data is sent base64-encoded.
- Prompt content, result content, warnings and stream parts are opaque JSON
  typed only by `type`, so the contract doesn't pin an AI SDK version. Call
  settings share the bounds presets use (`ModelParameters`).
- Before anything is sent the proxy answers with the usual error bodies
  (`llmProxyErrors`): `UNAUTHORIZED`, `FORBIDDEN` (a context the caller isn't
  in or the instance disallows), `VALIDATION` (a model that doesn't resolve or
  can't take the request), `RATE_LIMITED`, `BUDGET_EXCEEDED` (checked first)
  and `PROVIDER_UNAVAILABLE` (no key for this context). A failure after a
  stream starts is a final `error` part whose `error` is a `RunError`, safe to
  show.
- The resolved model ref is in the `x-resolved-model` header. Usage is
  recorded against the caller and the context when the call ends, including
  a call the client cancels by closing the request. There's no resume: a
  dropped stream is a failed call, and the client retries the step.

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
