# Does a web run carry on when the tab is closed? (ticket 303)

Code read at `51c75b2` (main). This worktree had no `node_modules`, so nothing
was re-run here. The existing tests cited below cover the main path.

## Verdict

**Yes for the core claim.** A run is executed by the in-process executor,
detached from any HTTP request. Closing the tab only ends one SSE
subscription. The run finishes, settles into the assistant message, and the
next run queued on the branch starts. Reopening the chat finds the active run
and follows its stream.

**But nothing tells anyone it finished or is waiting.** There is no
notification, no user-wide view of active runs, and no expiry on approvals.
`onSettled` covers the "done" case and is the natural hook. The "needs
approval" case has no hook at all yet.

## What happens, step by step

| Question | Answer | Where |
|---|---|---|
| Is the run tied to the request? | No. `POST /runs` places the row and calls `executor.start`. The pass is tracked in-process (`track`) and outlives the request. | `packages/server/src/runs/create-run.ts:478-479`; `packages/server/src/runs/executor.ts:87-101, 893-907` |
| What does closing the tab do? | It aborts the SSE response's own controller, which stops that subscription only. The run never sees it. | `packages/server/src/stream/sse.ts:44-75` |
| Does an abandoned run settle into the message? | Yes. `settle` writes the parts and status to the assistant message, then moves the row to a terminal state. `finishTerminal` closes the stream, calls `onSettled`, then `promoteAfter`. | `executor.ts:585-643, 409-423` |
| Is that tested? | Yes. Server in-process (PGlite): "The tab closed; the run goes on without it", then resume from `?cursor=` and `succeeded`. Playwright: "closing the tab mid-reply and reopening resumes the stream". | `packages/server/src/e2e.test.ts:180-250` (comment at :222); `e2e/tests/chat.spec.ts:197-220` |
| Is there a wall clock on the work? | Yes, per pass of the agent loop: `limits.runTimeoutSeconds` (default 600 s), passed to `agent.stream({ timeout })`. It probably ends as a **`cancelled`** run with `cancelledBy: null`, not `failed`: `onEnd` maps an abort to `cancelled` unless `onError` recorded a failure (`run-agent.ts:314-320`, `executor.ts:514-520`), so a timeout looks the same as a shutdown cancel. Untested. The comments also disagree on scope: `executor.ts:129` says per pass, `run-agent.ts:74` says "wall clock for the whole turn". | `packages/config/src/schema.ts:616`; `packages/server/src/services.ts:200`; `packages/ai/src/agent/run-agent.ts:307` |
| Do queued follow-ups proceed? | Yes. Every terminal path goes through `finishTerminal`, which ends in `promoteAfter`. That starts runs whose `afterRunId` is this run (one run per branch, D25). | `executor.ts:389-398, 422` |
| A follow-up sent while a run is paused for approval? | It doesn't queue. `moveOnFromWaiting` cancels the waiting run, as Stop would, and the new turn runs. | `create-run.ts:362-384` |
| Reopening the chat | `useFollowRunningReply` checks once per opened chat. If `runs.list({active:true})` has a running or awaiting run, it calls `resumeStream`. `reconnectToStream` replays from cursor 0, not from a saved cursor. Only in-tab reconnects use the cursor (`Last-Event-ID`/`?cursor=`). Replay is idempotent, so this is correct, just more bytes. | `packages/chat-ui/src/chat/connected-chat.tsx:725-757, 1246-1263`; `packages/chat-ui/src/model/run-activity.ts:48-56`; `packages/client/src/run-transport.ts:194-210`; `sse.ts:24-42` |
| Reopened after the run ended | The stream drains, sees the terminal status and ends. `run.prune` deletes the chunks 600 s after settling, and from then on the stored message is the only record. Clients must read the message, not replay chunks. | `packages/server/src/stream/postgres-stream-channel.ts:205-217, 268-277`; `packages/server/src/jobs/registry.ts:63`; `services.ts:165` |

## Approvals with nobody watching

- The pass ends at the pause. `settle` moves the row to `awaiting_approval`,
  doesn't call `finishTerminal`, and leaves the stream open
  (`executor.ts:635-642`). No process holds anything for it. The SSE
  heartbeat (15 s) only keeps a watching client's proxy alive
  (`sse.ts:19-20`).
- **It waits forever.** There is no timeout, TTL or sweeper. The code says
  so: "nothing expires a pause" (`create-run.ts:370`). `runTimeoutSeconds`
  doesn't count the pause, because it times each pass, not the run.
- Ways it ends: someone decides (`submitApprovals`, which resumes in the same
  transaction, `executor.ts:1015-1055, 1158-1197`); Stop (`cancelIdle`,
  `executor.ts:918-963`); or a new message on the branch
  (`moveOnFromWaiting`). Allowed transitions are in
  `packages/db/src/queries/runs.ts:221-228`.
- **It survives restarts.** `recover()` only looks at `running` rows.
- Approval cards can reach the stream while the pass is still running (133).
  The row becomes `awaiting_approval` only once that pass settles. A "needs
  you" notification sent on the transition can therefore lag the card by the
  rest of the pass.

## What `recover()` and shutdown do

- **Boot** (`packages/server/src/server.ts:496-503`) calls `executor.recover()`
  (`executor.ts:1129-1147`):
  - Every `running` row this process isn't executing is failed with
    `INTERRUPTED` ("The server restarted while answering. Try again.",
    retryable, `:157-161`). It goes through `failEarly` / `failOrphan`, so the
    stream gets an error chunk, the message becomes `error`, and
    `finishTerminal` runs (`onSettled` fires, the queue is promoted).
  - Then every `queued` row is started, if what it waits on is terminal.
  - `awaiting_approval` rows are left alone.
- **SIGTERM** (`apps/web/app/api/_lib/server.ts:43-45`) leads to
  `services.stop()` and then `executor.shutdown()` (`services.ts:249-252`,
  `executor.ts:1149-1154`). That aborts every executing pass, and each one
  settles as `cancelled` with `cancelledBy: null`. **A deploy or restart
  cancels in-flight runs.** They don't resume. A hard kill leaves them
  `running` until the next boot fails them.
- A resumed pass holds its approval reviews in memory only
  (`executor.ts:1183-1185`). A crash during it fails the run; nothing
  re-asks.
- **`executor.recover()` has no test.** No `*.test.ts` calls it (only
  sandbox-runner's own `recover`).

## Gaps between this and "notify me when it's done"

1. **No notification at all.** There's no `notification` or
   `push_subscription` table, no web push, no APNs. PLAN schedules them for
   the Collaboration wave (PLAN.md:86, 172, 710). The desktop shell denies the
   notifications permission (`apps/desktop/src/shared/navigation.ts:29`).
2. **There's nothing to hook "needs your approval".** `onSettled` is
   terminal-only (`executor.ts:124-125, 409-423`). The `await_approval`
   transition at `executor.ts:635-642` calls nothing.
3. **Approvals don't expire.** A forgotten approval holds its branch, and any
   run queued behind it, forever. It is also the case where a push matters
   most. We need to decide on a policy (expire after N hours and fail
   retryable? remind?) before we promise lock-screen approvals.
4. **Restarts cancel or fail runs without telling anyone.** Shutdown
   produces `cancelled` with `cancelledBy: null`. Crash plus recover produces
   `failed` "server restarted". Both pass through `onSettled`, so a
   notification layer must word these as "interrupted, retry", not "done".
5. **There's no user-wide "what's running" query.** `runs.list` needs a
   `conversationId` (`packages/contract/src/routes/runs.ts:56-70`), and the
   sidebar has no run state. An app coming back to the foreground can't ask
   "which of my chats finished or need me?" without one call per chat. That
   is a contract addition (its own PR).
6. **Who gets told?** `RunSettled.run.createdBy` is the starter. But any
   editor of a shared chat may decide approvals (`routes/runs.ts`
   `submitApprovals`), so recipients for "needs approval" in shared, org or
   team chats need `effectiveGrants`, not just `createdBy`.
7. **Reopen replays from 0.** That's fine on web. iOS can keep a per-run
   cursor and pass `?cursor=` (already supported). After a prune it must
   fall back to the stored message.
8. **Detachment rests on a single process (M1).** The executor is in the
   web process. A serverless or edge deploy, or several replicas without
   `apps/worker`, breaks D4. Docker is the only path today (D6), so this
   holds for now.

## Where the notification hook should sit

- **Terminal (done, failed, cancelled, interrupted):** `afterRun` in
  `packages/server/src/services.ts:158-176`, which is the `onSettled` the
  executor already calls exactly once per terminal run. It must not throw
  (`executor.ts:400-406` catches and reports). Do the following:
  - Enqueue a pg-boss job (`notify.run_settled`, `{ runId, status }`) next to
    `run.prune` and `title.generate`. Don't send inline, so APNs or web-push
    latency and retries stay off the run's path, and the job moves to
    `apps/worker` unchanged (D4).
  - Skip it when the user cancelled (`cancelledBy !== null`).
  - Ideally skip it when a client was watching to the end. Today there's no
    signal for that; adding a subscriber count to the stream channel would be
    a port change.
- **Awaiting approval:** add an `onAwaitingApproval?: (run: RunRow) =>
  Promise<void>` dep beside `onSettled` (`executor.ts:111-132`), called in
  `settle` after `transition` returns an `awaiting_approval` row
  (`executor.ts:635-642`), and wired in `services.ts` to enqueue
  `notify.awaiting_approval`. `InProcessExecutorDeps` isn't a
  `ports/` interface, so this isn't a contract change, but it does touch
  ticket 014's executor.
- **Expiry,** if adopted: a pg-boss delayed job enqueued from the same hook
  (`startAfterSeconds`). It calls `executor.cancel(runId, null)` or a new
  `fail` with a retryable `approval_expired`, so the run ends through
  `finishTerminal` and the terminal notification fires on its own.
- **Tests to add with it:** a `recover()` test (`running` gets failed,
  `queued` gets started, `awaiting_approval` is untouched, `onSettled` fires),
  and a hook test for the awaiting transition. Both are in-process with
  PGlite.
