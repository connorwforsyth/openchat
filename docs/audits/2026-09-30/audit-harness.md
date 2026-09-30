# Audit: the agent approval and run harness UX

Branch `t/audit-harness` (from `origin/main` @ 487c6e9). Evidence comes from a
code trace (file:line below) and from Playwright runs against the production
build of this worktree (`E2E_PORT=3187`, just-bash workspace, mock model),
taken under `scripts/ci/browser-lock.ts`.

Artifacts in this worktree:

- `e2e/support/mock-llm.ts`: the mock now takes `[script:<name>]`, which plays
  a scripted multi-step sequence (`SCRIPTS`). A step can call several tools.
  Committed on the branch, because it is reusable for regression specs.
- `e2e/tests/zz-audit-harness.spec.ts` and `zz-audit-debug.spec.ts`: the
  measurement harness (not committed). It uses a MutationObserver to count
  every approval card that mounts, logs every `POST /runs/{id}/approvals`
  with its body and status, and reads back the server's view (stored parts,
  run statuses).
- `.context/audit-results.json`: raw numbers. `.context/after-*.png` are
  screenshots.

**Bottom line.** Few of the prompts are duplicates. The policy asks for one
review per `write`/`edit`. The jank comes from the prompts being *hidden*,
*flashing back* and *misreported*:

1. After the first decision in a turn, every later approval card is
   invisible. The answer shows "Thinking…" forever, so the user must reload.
2. A reload soon after activity renders a stale cached copy that says
   "Stopped / This answer stopped early", with no card, and it never
   refetches.
3. Deciding one card re-mounts every card in the message with its Approve
   button back. The server accepts the repeat and even a flip from approve to
   reject.
4. Stop doesn't stop anything on the server.

---

## 1. The flow as implemented

### 1.1 Policy: which calls ask

The brief mentions `needsApproval` in `packages/sandbox/src/tools/tools.ts`,
but that does not exist. The sandbox tools (`bash`, `read`, `write`, `edit`,
`preview`, tools.ts:456-558) carry no approval flag. Approval is a
`Record<toolName, ToolApprovalStatus>` handed to the AI SDK's `ToolLoopAgent`
(`packages/ai/src/agent/run-agent.ts:138-146`).

- **Plain chat (no agent).** `modelTurn` (`packages/server/src/runs/turn.ts:441-472`)
  gets its sandbox tools from `chatSandboxTools` (turn.ts:404-421). Their
  approval is `chatSandboxApproval` (`packages/server/src/runs/sandbox.ts:143-151`):
  `write` and `edit` are `"user-approval"`, everything else is
  `"not-applicable"`. There is no per-chat or per-user override, and no UI to
  change it.
- **Agents.** `toolApprovalModeSchema = z.enum(["auto","ask"])`
  (`packages/contract/src/schemas/library.ts:73`). `approvals.default` is
  `"auto"`, plus per-tool overrides (library.ts:75-81). `withSandboxTools`
  (sandbox.ts:121-140) forces `write` and `edit` to `"ask"` unless the agent
  names them itself. `resolveTools` combines these with `stricter(...)` and
  `alwaysAsk` (`packages/ai/src/tools/resolve.ts:80-98`). `toStatus` maps
  `ask` to `"user-approval"` (`packages/ai/src/tools/tool-set.ts:68-69`), and
  the result goes to `gated.toolApproval` (turn.ts:557-579).
- **What gets reviewed.** For a paused `write`/`edit`, the executor asks
  `turn.proposeEdits` (`packages/sandbox/src/handlers/turn-tools.ts:344-367`
  → `proposeSandboxChange`, tools.ts:287-293) for a unified diff stamped with
  the SHA-256 of the base file (tools.ts:254-281). That diff is stored on the
  pending approval as `edits`.
- `bash` never asks. It can write any file (`echo > f`), so the `write`/`edit`
  gate is a **review** step, not a safety boundary.

### 1.2 The run state machine (server)

The states are `runStatusSchema` (`packages/contract/src/schemas/runs.ts:32-39`).
Transitions are compare-and-set in `packages/db/src/queries/runs.ts:199-216`:

| transition | from | to | where |
|---|---|---|---|
| start (claim) | queued | running | `claim`, executor.ts:664-701 (inserts the empty assistant message, `status: "partial"`, :678) |
| await_approval | running | awaiting_approval | `settle` → `landing`, executor.ts:400-416; `approvals` (with `edits`) stored on the run row |
| resume | awaiting_approval | running | `submitApprovals`, executor.ts:885, once **every** pending call has a decision (:881-884) |
| succeed | running | succeeded | executor.ts:395-399 |
| fail | queued/running/awaiting | failed | `failEarly` :333-347, boot `recover` fails orphaned `running` runs only (:810-828) |
| cancel | queued/running/awaiting | cancelled | `cancel` :761-788 (abort the in-process pass, or `cancelIdle` :738-758) |

Notes:

- **Every pause is a new pass.** `execute` (executor.ts:595-661)
  re-resolves the turn (model, keys, sandbox, tools), rebuilds history with the
  decisions (`toUIMessages` maps `decided` → `approval-responded`,
  `packages/ai/src/messages/to-ui.ts:128-137`), and calls `runAgent`
  again. The SDK executes the approved calls, reports denials, and continues
  the same assistant message.
- `DEFAULT_MAX_STEPS = 20` is per pass (run-agent.ts:83,143), so a run with
  many approvals has no overall step cap.
- The per-hunk review reaches the tool through in-memory `reviews`
  (`reviewsFor`, executor.ts:204-219, :893-895 →
  `reviewFor`, turn-tools.ts:419-426 → `applySandboxChange`, tools.ts:346-404).
  `applySandboxChange` refuses a file edited while the change waited
  (tools.ts:356-363).
- `awaiting_approval` never expires. It survives restarts (`recover` only
  touches `running`). It also blocks the branch: a new message on it is queued
  behind it (`busyTail`, `packages/server/src/runs/create-run.ts:72-92`).

### 1.3 Persistence and streaming of a pause

- **Stored message parts.** `fromUIMessage` maps each tool part to a
  `tool-call` with `approval: not-required | pending{requestedAt} | decided{decision, decidedBy, decidedAt}`
  and an optional `tool-result` (`packages/ai/src/messages/from-ui.ts:77-152`).
  A human-approved part with no recorded decision is an error
  (`missing_decision`, from-ui.ts:84-91). `settle` supplies recorded
  decisions from the DB (executor.ts:442-447).
- **Run stream.** Chunks are appended to the StreamChannel (Postgres
  `run_chunk` rows + NOTIFY, `packages/server/src/ports/stream-channel.ts`),
  served as SSE by `GET /api/runs/:id/stream` (`packages/server/src/app.ts:113-130`,
  `packages/server/src/stream/sse.ts:45-109`, `id:` = seq, 15 s heartbeat,
  `[DONE]` on end).
- **The stream stays open while awaiting approval.** `settle` doesn't close it
  (executor.ts:476-480). Only `finishTerminal` does (:317-331). The resumed
  pass keeps writing into the same stream.
- The AI SDK emits `tool-approval-request` when the pass pauses. **On resume
  it emits no `tool-approval-response` chunk.** It runs the approved tool
  and then emits `tool-output-available`/`-denied`
  (`ai@7.0.116` dist/index.js:10675-10760). The live client part therefore
  stays `approval-requested` until the output lands.

### 1.4 Deciding: `runs.submitApprovals`

The contract is `packages/contract/src/routes/runs.ts:71-81`, the handler
`packages/server/src/api/router.ts:516-557`, and the executor side
executor.ts:839-907:

1. It requires `status === awaiting_approval`, else `invalid_state` → 409
   `not_awaiting_approval`.
2. Every decision's `toolCallId` must be in `row.approvals` (:848-856). It
   does **not** check whether that call is already decided.
3. It reads the answer's parts, overwrites `approval` on the decided calls and
   writes them back (:857-880). This is a read-modify-write with no
   transaction or lock.
4. When all pending calls are decided it runs a `resume` CAS and starts a new
   pass (:881-906).

### 1.5 Client: stream, chat state and cards

- **Transport.** `createRunTransport` (`packages/client/src/run-transport.ts:136-216`)
  handles two cases. Sending creates a run and reads its SSE from cursor 0.
  `reconnectToStream` **always replays from cursor 0** (:164-180). With no
  known stream it asks `runs.list({active:true})` and follows that run.
  `readRunStream` reconnects on drops (`run-stream.ts:133-231`).
- **`useRunChat`** is `useChat` over that transport (`use-run-chat.ts:95-103`).
  `useChat.status` is `streaming` for as long as the SSE is open, which
  includes the entire `awaiting_approval` period.
- **`ConnectedChat`** (`packages/chat-ui/src/chat/connected-chat.tsx`):
  - `useLiveTurn` (:272-349): while `busy || settling`, the streaming
    assistant message is the **live** `UIMessage` mapped by `mergeLive` →
    `liveParts` (`packages/chat-ui/src/model/live-messages.ts:35-48, 85-133`).
    Otherwise it is the stored path (`messages.path`).
  - `useChatQueries` (`use-chat-data.ts:31-113`): `activeRun` = first run in
    `awaiting_approval` (:90-92). `runningRunId` = first `running|queued`
    (:95-99). `pendingApprovals` come from `activeRun.state.approvals`
    (connected-chat.tsx:1037-1041).
  - `useApprovalsInSync` (:428-462): if a call on screen is `pending` but the
    fetched run doesn't list it, refetch (10×500 ms).
  - `useFollowRunningReply` (:539-565): a page opened mid-reply follows a
    `running|queued` run. It does not follow an `awaiting_approval` run.
  - **`onDecide`** (:921-942): `submitApprovals` for one call. If there is no
    `activeRun` yet, `awaitingRunFor` (:473-500, the ticket-066 retry) polls
    `runs.list` 10×500 ms for the run waiting on that call.
    `onSettled` (success **or error**) runs `refresh()` (invalidates messages,
    runs, conversations, artifacts, sandbox) and `resumeStream()`. There is no
    `onError`.
  - Stop: `composer.onStop = chat.stop` (:1053). This aborts only the client
    reader. Nothing in the UI calls `runs.cancel`.
- **Rendering.**
  - `messageView` keys blocks `${part.type}-${index}` (`model/parts.ts:202`).
  - `ToolPart` (`conversation/tool-part.tsx:22-61`) shows `ToolStatus`, or a
    `FileChangeCard` once a file change has a result. It shows `ApprovalCard`
    when `summary.status === "awaiting"`
    (`statusOf`: pending and no result, `model/tool-summary.ts:202-214`).
  - `ApprovalCard` (`conversation/approval.tsx:25-154`) holds a local `sent`
    flag (:31). After a click it shows "Decision sent. Waiting for the
    agent…" (:65-75). For write/edit it shows a `DiffView` per file with
    per-hunk accept/reject ("Submit review", "Accept the rest"), plus
    "Reject all" / "Approve all". "Reject all" takes two clicks (reason form).
  - A call with no result in a non-streaming message shows **"Stopped"**
    (tool-part.tsx:48). A `partial` message shows **"This answer stopped
    early."** (`message-row.tsx:136-145, 341`). A streaming message with no
    blocks shows **"Thinking…"** (:333-339).
- **Cache.** The query client persists `messages.path` for the last 5 chats to
  IndexedDB (`apps/web/app/(app)/_shared/query-persistence.ts:51-55`) with
  `staleTime: 30_000`, `refetchOnWindowFocus: false`
  (`apps/web/app/(app)/_shared/app-frame.tsx:359-366`).

### 1.6 State machine as the user meets it

```
server run:  queued ─start─▶ running ─pause─▶ awaiting_approval ─(all decided)─▶ running ─▶ … ─▶ succeeded|failed|cancelled
                              ▲                      │  (SSE stays open, no expiry, branch blocked)
                              └──────── resume ──────┘

stored call: not-required
             pending ──submitApprovals──▶ decided(approve|reject|review) ──pass──▶ + tool-result(success|error|denied)
                  ▲____________________ (re-decidable while run still awaiting) _____|

live call:   input-available → approval-requested ──(no chunk on resume)──▶ output-available | output-error | output-denied

UI tool:     awaiting (card) → running ("Stopped" if message not streaming) → done/error/denied (FileChangeCard / status)
UI message:  streaming+no blocks → "Thinking…";  partial+not streaming → "This answer stopped early."
composer:    busy (Stop, Send disabled) for the whole time the SSE is open, including awaiting_approval
```

---

## 2. Measurements

Harness: a "patient person" clicks the first visible Approve (after 250 ms),
and reloads when nothing on screen changes for 15 s. The mock scripts are:

- (a) `index.html` → `style.css` → `script.js`, one write per step, then
  `preview` (a') all three writes in one step (parallel tool calls)
- (b) seed `notes.txt`, then `edit` twice
- (c) write `package.json` → `bash npm install` → write two sources →
  `bash npm test` (just-bash has no npm, so the bash steps fail fast; bash
  doesn't ask either way)
- (d) seed `doc.txt`, then `read` + `write`
- (d') a write is proposed, the user edits the file by hand while it waits,
  then the user approves.

### 2.1 Approval-count table

"Card mounts" counts every approval card element that appeared.
"Duplicate/stale" is mounts beyond the first per call, plus decisions POSTed
again for a call that was already decided. "Hidden" is a policy-required
prompt that never appeared live and needed a reload.

| task | total prompts (card mounts) | accidental duplicates / stale | policy-required (server) | hidden until reload | reloads needed | POSTs (dup) |
|---|---|---|---|---|---|---|
| (a) 3-file site, sequential | 3 | 0 | 3 | **2** | 3 | 3 (0) |
| (a') 3-file site, one step | **18** | **15 re-mounts; 5 duplicate decisions** | 3 | 0 | 0 | 8 (**5**) |
| (b) edit twice | 2 | 0 | 2 | **1** | 1 | 2 (0) |
| (c) scaffold | 3 | 0 | 3 | **2** | 4 | 3 (0) |
| (d) re-read + rewrite | 1 | 0 | 1 | 0 | 0 | 1 (0) |
| (d') user edits while pending | 2–3 | 0–1 (the approved card flashes back; timing) | 2 (**1 wasted**: refused as stale, re-asked) | **1** | 2 | 2 (0) |

- Wall time with a patient user was 48 s for (a) and 64 s for (c). With the
  mock, nearly all of it was waiting for a card that never appeared.
- Without the hidden-card bug, (a) finishes in under 2 s and (a') in 6.5 s.
- The reload count exceeds the hidden-prompt count because a reload within
  30 s of the last fetch shows a stale page (finding F2).
- Stream subscriptions opened per task: 3–4 sequential, 7 batched. Every
  decision reconnects and replays from 0.

### 2.2 Probes

| probe | result |
|---|---|
| rapid double-click Approve | 1 POST, run succeeded. Safe: the card hides synchronously. |
| Approve, then reload at once | POST landed (200). After reload: 0 cards, run succeeded. Safe. The card flashed back once before the reload. |
| Reject all | 1 reject (denied result stored). The agent went on to propose the next file (`style.css` pending) while the page showed only "Thinking…" (F1). "Reject all" does not mean "stop". |
| Stop during a pending approval | Stop is visible, because the SSE is open during the pause. After Stop the run is **still `awaiting_approval`**. The card is still there, also after reload. |
| Stop during a running tool | Stop is visible. The run stayed **`running`** and the 20 s `sleep` finished; the run **succeeded**. Stop never reached the server. |
| Close tab mid-run, reopen | The reopened tab showed the pending `style.css` card (good). After approving, the `script.js` card stayed hidden until a reload (F1). |
| Two tabs, same approval | Tab A 200, tab B **409 `not_awaiting_approval`, silently swallowed**. B's card vanished into "Thinking…". B never shows the next card. |
| Two tabs, different calls of one step | Both 200, both stored (no lost update on PGlite). |
| Concurrent API decisions on different calls (5×) | 5/5 kept both decisions on PGlite. The race in F9 is code-level and not reproduced here. |
| Re-decide a decided call | approve → 200, then reject of the **same call** → 200. The stored decision flipped to `reject`. |
| New message while an approval waits | Before reload, Send is unavailable (the composer is busy). After reload the new message's run is **`queued` behind `awaiting_approval`**. The waiting answer says "This answer stopped early." |

---

## 3. Findings

Severity: **Critical** means the agent looks broken on an ordinary multi-file
task. **High** means frequent confusion or wrong behaviour. **Medium** and
**Low** follow from that.

### F1 — Critical: after the first decision, later approval cards are invisible ("Thinking…" forever)

- **Repro.** `[script:site]` (any task with two or more sequential
  write/edit). Approve the first card. The answer turns into "Thinking…"
  (`.context/after-approve-1.png`). The server is `awaiting_approval` on
  `style.css`, but no card appears until reload. Measured in (a), (b), (c),
  (d'), close/reopen, reject-all and two-tabs.
- **Root cause.**
  - Every decision calls `resumeStream()`, which replays the run stream from 0
    (connected-chat.tsx:926-930, run-transport.ts:164-170).
  - The replayed approved call ends as `output-available` and still carries
    the `approval` object from the request chunk. The SDK keeps it
    (`updateToolPart`), and no `tool-approval-response` chunk is ever
    streamed on resume.
  - `liveParts` maps with `decisionFor: () => undefined`
    (live-messages.ts:35-40). `callApproval` therefore fails with
    `missing_decision` (from-ui.ts:84-91).
  - The fallback keeps only `text`/`reasoning` parts (live-messages.ts:43-47).
    **Every** tool part of the message disappears, including the new pending
    call.
  - The SSE stays open during the new pause (executor.ts:476-480), so `busy`
    stays true. The live copy keeps overriding the stored one (mergeLive,
    :110-127). `useApprovalsInSync` sees no pending ids, so nothing refetches.
- **Unit repro.** `liveParts({parts:[executedApprovedCall, nextRequestedCall]})`
  returns `[]`. Before any decision it returns `["tool-call"]`.
- **Fix.**
  - Make `liveParts` tolerant: map per part, not all-or-nothing.
  - For a live part that has an `approval` and an output, synthesize a
    decision (`approve` for output-available/error, `reject` for
    output-denied). Better, pass the stored message's recorded decisions into
    `mergeLive` as `decisionFor`.
  - Also consider having the server stream a `tool-approval-response` chunk
    when a pass resumes.
  - Add an e2e spec: two sequential writes, both approved without a reload.

### F2 — High: a reload shortly after activity shows a stale "Stopped / stopped early" page with no card and never refetches

- **Repro.** `[script:site]`, approve, wait 3 s, reload. The page shows the
  first write as "Stopped" and "This answer stopped early."
  (`.context/after-reload-1.png`). No card appeared within 40 s (the debug
  spec timed out). A reload 30 s or more after the last fetch shows the card.
  This produced the extra reloads in (a) and (c).
- **Root cause.**
  - `messages.path` is persisted to IndexedDB (query-persistence.ts:51-55).
    With `staleTime: 30_000` (app-frame.tsx:365), the restored entry counts
    as fresh, so there is no refetch on mount.
  - The restored copy is the one fetched by `refresh()` right after the
    decision: the decided call with no result, and the next call not yet
    there.
  - `runs.list` is not persisted and correctly says `awaiting_approval` with
    the new call. Nothing compares `activeRun.approvals` against the calls on
    screen: `useApprovalsInSync` only handles "pending on screen but not on
    the run" (connected-chat.tsx:437-440).
- **Fix.**
  - Add the reverse sync: if `activeRun.state.approvals` lists a call the
    messages don't have, invalidate `messages.path`.
  - Use `refetchOnMount: "always"` for `messages.path` of the open chat, or
    whenever `runs.list` reports an active run.
  - Or don't persist the path of a conversation with an active run.

### F3 — High: deciding one card re-mounts every card with Approve back on; the server accepts the repeat

- **Repro.** (a') `[script:site-batch]` gives three cards. Clicking Approve on
  `index.html` makes all three cards unmount and remount after about 300 ms,
  and `index.html` shows Approve again. Measured: **18 card mounts and 8 POSTs
  for 3 calls, 5 of them for the same already-approved call**, all 200. In
  sequential tasks the approved card flashes back until its output arrives
  (d', stop-running, approve-reload, two-tabs: 2 mounts for 1 call).
- **Root cause.**
  - `resumeStream()` after every decision (connected-chat.tsx:929) starts a
    fresh message state. The AI SDK passes `lastMessage: undefined` for
    `resume-stream`, and the stream replays from cursor 0
    (run-transport.ts:169).
  - The message is rebuilt from empty, so the index-keyed blocks
    (parts.ts:202) unmount, and `ApprovalCard`'s local `sent`
    (approval.tsx:31) resets.
  - The live part still says `approval-requested` because no response chunk
    exists.
  - On the server, `submitApprovals` checks only that the call is in
    `row.approvals`, not that it is still undecided (executor.ts:848-880).
- **Fix.**
  - Client: track decided call ids in `ConnectedChat` state, or derive
    "decided" from the stored parts, and hide the card for them. Key tool
    blocks by `toolCallId`. Don't `resumeStream()` when the chat is already
    streaming this run (the open SSE will carry the resumed pass).
  - Server: reject decisions for calls already decided with 409
    `already_decided` (or treat an identical decision as a no-op).

### F4 — High: Stop doesn't stop the run

- **Repro.** Stop during a pending approval leaves the run `awaiting_approval`.
  Stop during `bash sleep 20` leaves it `running`, and it later succeeds.
- **Root cause.** `onStop: chat.stop` (connected-chat.tsx:1053) only aborts
  the client's SSE reader. No UI calls `runs.cancel` (grep: none in
  chat-ui/composer/web). Stop is also offered during a pause because
  `useChat.status` is `streaming` while the SSE is open (composer.tsx:150,
  composer-footer.tsx:89-98).
- **Fix.** Make `onStop` call `runs.cancel({id})` for the active run, then
  `chat.stop()`. The server already handles cancel from `running` (abort)
  and from `awaiting_approval` (`cancelIdle`, executor.ts:738-758). In the
  pause, label it "Stop agent" or show it next to the cards.

### F5 — Medium: a pending approval blocks the conversation

- **Repro.** While a card waits, Send is unavailable (the composer is busy).
  After a reload the user can send, but the new run is `queued` behind the
  waiting one indefinitely (probe "new message while waiting"). There is no
  expiry and no "decide later".
- **Root cause.**
  - The SSE is open, so `busy` is true (executor.ts:476-480, composer.tsx:150).
  - The one-run-per-branch queue treats `awaiting_approval` as active
    (`busyTail`, create-run.ts:72-92; `ACTIVE_RUN_STATUSES`).
  - `awaiting_approval` never times out (executor `recover` :810-828 touches
    only `running`).
- **Fix.**
  - Let the composer send while awaiting.
  - Server: a new message on a branch with an `awaiting_approval` run should
    reject the pending calls with the message as the reason, or cancel that
    run, rather than queue behind it.
  - Show "Waiting for your approval above" in place of Stop.

### F6 — Medium: misleading status text around approvals

- **Repro.**
  - A reloaded answer that is waiting for approval, or still running, shows
    "This answer stopped early."
  - A decided call whose pass is still running shows "Stopped".
  - During the pause, the answer shows "Thinking…" (because of F1).
- **Root cause.**
  - The assistant message is `partial` while running (executor.ts:678) and
    while awaiting (:413).
  - `StatusNote` renders every non-streaming `partial` as "stopped early"
    (message-row.tsx:136-145, 341).
  - `stopped={!streaming && summary.status === "running"}` (tool-part.tsx:48)
    ignores the run state.
- **Fix.** Derive "awaiting your decision" and "working…" from the run state
  (`runs.list`) for the message whose `runId` is active. Only say "stopped
  early" for terminal `cancelled`/`failed` runs.

### F7 — Medium: a failed decision looks sent (silent 409)

- **Repro.** Two tabs: tab B's Approve gets a 409 and nothing is shown. The
  card becomes "Decision sent…", then vanishes into "Thinking…".
- **Root cause.** `decide(...)` has only `onSettled` (connected-chat.tsx:924-931).
  The latent variant: if `activeRun` is a stale copy of the same run (same id,
  older approvals) and the user decides a call before the server records the
  pause, the POST gets a 409 and is dropped. `awaitingRunFor` only covers the
  case where there is no `activeRun` (:933-941).
- **Fix.** Add `onError`: on `not_awaiting_approval`, refetch the run and
  message. If the call is decided, say "Already decided (by you in another
  tab / by X)". Otherwise retry through `awaitingRunFor`. Surface other
  errors with a toast and restore the card.

### F8 — Medium: a decided call can be flipped while its siblings are pending

- **Repro.** Batch step: approve call 1 (200), then reject call 1 (200). The
  stored decision is `reject`, and the reject is what executes.
- **Root cause.** executor.ts:848-880 accepts any call in `row.approvals`.
- **Fix.** Same server check as F3.

### F9 — Low/Medium: `submitApprovals` is a racy read-modify-write

- **Root cause.** The executor reads the message parts
  (`getMessage`, executor.ts:857), maps them, and writes them back
  (`updateMessage`, :880) with no transaction or row lock. Two concurrent
  decisions on *different* calls can each overwrite the other. The run would
  then never see all calls decided, and a card would return as pending.
- **Evidence.** Not reproduced on PGlite (5/5 fine, and the queries are
  effectively serialized). Postgres with a connection pool can interleave.
- **Fix.** Do it in a transaction with `SELECT … FOR UPDATE` on the run row,
  or update per call (`jsonb_set`), or keep decisions on the run row/table and
  merge them into the parts at settle.

### F10 — Low: a second tab never follows the run

- **Root cause.** `useFollowRunningReply` follows only `running|queued`
  (connected-chat.tsx:539-565, use-chat-data.ts:95-99). A tab opened during a
  pause, or whose decision 409'd, is left on whatever it had.
- **Fix.** Follow `awaiting_approval` runs too, since their stream is open and
  carries the resumed pass. Or poll `runs.list` while a run is active.

### F11 — Low: every decision opens another SSE and replays the whole run

- **Evidence.** 3–7 subscriptions per task (§2.1).
- **Root cause.** `resumeStream()` per decision; `reconnectToStream` replays
  from 0 (run-transport.ts:164-170). The AI SDK's `makeRequest` only aborts a
  previous *resume* request, not the original `sendMessages` response, so two
  readers apply the same chunks to the same message.
- **Fix.** Covered by F3's "don't resume if already streaming". If a replay
  is needed, pass the known cursor and keep the message.

### F12 — Low: the stale-edit guard costs a wasted prompt

- **Repro.** (d'): the user edits `doc.txt` while the write waits, then
  approves. The write is refused ("was edited while this change waited…",
  tools.ts:358-362), and the agent re-reads and asks again. That is two
  approvals for one change, and the first shows a diff that is already out
  of date.
- **Fix.** When the Files panel saves a file that has a pending proposal,
  re-propose against the new contents: refresh the pending approval's `edits`
  or mark the card "file changed, diff refreshed". That way the user never
  approves a diff that can't apply.

### Checked and fine

- Double-click Approve: 1 POST.
- Approve then immediate reload: decision kept, no card after reload.
- Close tab and reopen during a pause: the card is restored from stored parts
  (then F1 applies to the next one).
- The resume CAS prevents double execution when two decisions finish at once
  (executor.ts:885-889).

---

## 4. Policy-required prompts and what scoped permissions would change

These prompts are what the current policy asks for, measured once F1–F3 are
discounted:

| task | policy-required prompts | why |
|---|---|---|
| (a) 3-file site | 3 | one `write` each; `preview` doesn't ask |
| (b) edit twice | 2 | two `edit`s |
| (c) scaffold | 3 | 3 `write`s; the two `bash` calls (install, test) never ask |
| (d) re-read + rewrite | 1 | one `write` over a file the user edited |
| (d') edit while pending | 2 | 1 original + 1 re-ask after the stale-hash refusal |

Observations for the permission design. The other agent owns the full design.

- **Every sequential step is its own prompt and its own round trip.**
  Real models emit one write per step, and each approval is a full
  pause → resume → new model call pass. Batching per step (a') doesn't reduce
  prompts for sequential models. Scope is the lever.
- **The gate is inconsistent.**
  - `bash` (which can overwrite any file, run `npm install`, or delete the
    tree) never asks.
  - `write` to a brand-new file in a fresh workspace always asks.
  - Plain chats have no way to relax this (`chatSandboxApproval` is fixed,
    sandbox.ts:143-151).
  - Agents can only set `auto`/`ask` per tool name for the whole agent
    (library.ts:73-81).
- **With a scoped model**, for example "allow file changes in this
  chat/workspace for this run", "for this turn", or "for paths under X", with
  auto-apply plus per-change undo:
  - (a) goes from 3 prompts to 0–1 (approve the first, choose "allow for this
    turn").
  - (b) goes from 2 to 0–1.
  - (c) goes from 3 to 0–1.
  - (d) remains a good candidate to **keep** asking, because the agent is
    overwriting content the user edited by hand. "Ask when the base file was
    last written by a person" is a natural scope rule.
  - (d') loses its wasted prompt. With auto-apply the stale-hash check runs
    at execution time against the current file, so there is nothing to
    refuse.
- **Two things keep mattering under any scope model:**
  - The review diff for changes that still ask, and a clear "Stop agent" /
    "reject and stop" (today "Reject all" only rejects one call and the
    agent proposes the next).
  - An audit trail of auto-applied changes. The FileChangeCard already shows
    one per change.
- **The decision should outlive a single pass.** Today `reviews` are held in
  memory for one pass (executor.ts:893-895), and there is no run-level or
  chat-level grant to consult in `chatSandboxApproval`/`withSandboxTools`. A
  scoped grant would plug in at those two functions, which build the
  `toolApproval` map per pass. Returning `not-applicable` for granted tools
  removes the pause entirely.
