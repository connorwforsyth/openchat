# opencode harness patterns (research, 2026-09-30)

Everything here comes from `anomalyco/opencode`, branch `dev`, commit 2fa3363. File paths are relative to https://github.com/anomalyco/opencode/blob/dev/. The docs page https://opencode.ai/docs/permissions is `packages/web/src/content/docs/permissions.mdx` in that repo.

## Permission model
- **Actions:** read, edit (covers write and patch), glob, grep, bash, task, skill, lsp, question, webfetch, websearch, external_directory and doom_loop.
- **Rules:** each rule is `{permission, pattern, action: allow|ask|deny}`. The last matching rule wins (wildcards `*` and `?`). If no rule matches, the answer is `ask`. Source: `packages/opencode/src/permission/index.ts` (`evaluate`).
- **Merge order:** defaults, then the agent's own rules, then the user's global config, then the user's per-agent config, then session rules, then runtime "always" grants. Sources: `agent/agent.ts` L119-160, L293; `session/tools.ts` L87.
- **Bash scoping:** the command is parsed with tree-sitter into sub-commands. The "always" suggestion is the command prefix plus ` *` (for example `git checkout *`), using an arity table. Sources: `tool/shell.ts` ~L391-410, `permission/arity.ts`.
- **Edit scoping:** the pattern is the path relative to the worktree, and the suggested "always" is `*`. Paths outside the worktree need a separate `external_directory` permission.
- **Hidden tools:** a tool whose rules end in `*: deny` is removed from the model's tool list (`visibleTools`).
- **The ask:** `{id, sessionID, permission, patterns[], metadata (diff/command), always[], tool:{messageID, callID}}`. The reply is `once | always | reject`, with an optional message. A reject with a message becomes `CorrectedError` and the run continues.
- **Where "always" grants live:**
  - V1 keeps them in memory for the process ("until OpenCode is restarted").
  - V2 stores them in SQLite, scoped per project, with no expiry. You can list them and revoke them with `DELETE /api/permission/saved/:id`. Sources: `core/src/permission/saved.ts`, `server/src/handlers/permission.ts`.
  - V2 applies deny rules before saved grants, so a grant can never override a deny (`core/src/permission.ts` `evaluateInput`).

## Repeated and parallel requests
- **No deduplication:** every parallel call gets its own pending entry, and the client shows a queue.
- **Always:** after an "always", other pending requests (same session in V1, same project in V2) are re-evaluated and resolved automatically.
- **Reject:** it rejects every other pending request in the session.
- **Run outcome:** a plain reject stops the loop (`blocked`, `"stop"`), unless `continue_loop_on_deny` is set. A reject with a message, or a deny, returns an error to the model and the run continues. Source: `session/processor.ts` L200, L665-694.

## Tool-call states
- **Lifecycle:** `pending{input}`, then `running{input, title, metadata, time.start}`, then `completed{output, title, metadata, time, attachments}` or `error{error, metadata, time}`. Transitions are guarded: completion and error only apply while the call is running. Source: `schema/v1/session.ts` L259-313.
- **Live output:** progress streams through `metadata` while a call runs; the shell streams the tail of its output.
- **Session status:** `idle | busy | retry{attempt, message, next}`.
- **Persistence:** every part update is written through (`message.part.updated`, then an SQLite projector).

## Cancellation
- **Endpoint:** `POST /session/:id/abort` cancels background jobs recursively and interrupts the runner (`session/run-state.ts`).
- **Shell:** on abort it kills the process (force-kill after 3 s), keeps the partial output, and notes "User aborted the command" (`tool/shell.ts` L533-567).
- **Leftover tool calls:** after 250 ms they become `error: "Tool execution aborted"` with `interrupted: true`, and later turns skip them. Source: `processor.ts` ~L590-607, `prompt.ts` L96.
- **Gap:** on abort a pending permission is deleted from memory but no `replied` event is sent. Clients keep a stale prompt until they re-sync, and a late reply gets a 404.
- **New message mid-run:** it is saved, then joins the running loop, which picks up the latest user message on each iteration. There is one runner per session. Sources: `prompt.ts` L1052-1070, L1346, `effect/runner.ts`.

## Reconnection and recovery
- **Transport:** SSE sends `server.connected` first, then a heartbeat every 10–15 s. There is no Last-Event-ID replay.
- **Resync:** on connect the client takes a snapshot, including a GET of pending permissions (which replaces the local list), then applies events upserted by ID, so duplicates are harmless. Sources: `app/src/context/server-sync.tsx` L547-570, `global-sync/bootstrap.ts` L447-475, `event-reducer.ts` L397-425.
- **Stale or double replies:** the server removes the entry on the first reply, so later replies get a 404. The handler also checks the request's session. The client keeps a 1-hour TTL map of IDs it has already replied to, and clears an ID if the reply fails. Source: `app/src/context/permission.tsx` L228-282.
- **Restart:** pending asks are rejected; saved grants survive.

## Other safeguards
- **Doom loop:** three identical tool calls in a row trigger a `doom_loop` ask (`processor.ts` L29, L356-380).
- **Auto modes are client-side:** they reply `once` to every ask, and denies still hold because the server decides them. Headless runs without `--auto` reject every ask. Sources: `tui/src/context/sync.tsx` L196-205, `cli/cmd/run.ts` L805-822.
- **Auditing is thin:** logs, the asked/replied events, and the saved-grant rows.

## Patterns to borrow
1. Rules are checked in order, the last match wins, and anything unmatched is asked.
2. Deny is checked on the server before any grant.
3. The tool proposes a bounded "always" scope (a command prefix or path glob), and the server stores it.
4. Tools that are fully denied are hidden from the model.
5. An ask is tied to its tool call, with the diff or command attached.
6. "Always" resolves matching queued asks; "reject" clears the queue.
7. A plain reject stops the run; a reject with feedback redirects it.
8. Saved grants are rows the user can list and revoke.
9. Tool calls have four states with guarded, persisted transitions and live metadata.
10. Abort turns leftover calls into `error` with `interrupted: true` and keeps partial output.
11. One runner per chat; a new message joins the running loop.
12. Reconnect means a snapshot then events upserted by ID. **Do better than opencode here:** send a resolved or cancelled event when an abort drops a pending ask.
