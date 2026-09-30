---
id: "072"
title: "Approval harness: live cards, idempotent decisions, real Stop, honest states"
labels: [wayfinder:build]
status: closed
assignee:
blockedBy: []
---

## Question

Connor finds the harness janky and suspects too many approval prompts. The audit
(`docs/audits/2026-09-30/audit-harness.md`) measured it: most jank is policy-required prompts being hidden, repeated
or misreported, not extra prompts. Findings, with file:line in the audit:
1. **Critical: later cards never appear after the first decision.** On resume the approved call keeps `approval`
   without an approval-response chunk. `liveParts` passes no decisions (`chat-ui/src/model/live-messages.ts:35-48`),
   so `ai/src/messages/from-ui.ts:84-91` fails with `missing_decision` and the fallback drops all tool parts, while
   the stream stays open during the pause (`executor.ts:476-480`).
2. **High: a reload after activity shows a stale page.** `messages.path` is persisted with a 30 s `staleTime`
   (`app-frame.tsx:365`, `query-persistence.ts:51-55`), and nothing reconciles a run's pending calls against what's
   rendered (`connected-chat.tsx:437-440`).
3. **High: deciding one card re-shows Approve on every card, and the server accepts re-decisions.** Each decision
   calls `resumeStream()`, which replays from 0 (`connected-chat.tsx:929`, `run-transport.ts:169`). Blocks are
   index-keyed (`parts.ts:202`), so `ApprovalCard` remounts and loses its sent state (`approval.tsx:31`). The server
   doesn't reject decided calls (`executor.ts:848-880`) and allows approve→reject flips.
4. **High: Stop doesn't stop the run.** `onStop` is `chat.stop` (`connected-chat.tsx:1053`); nothing calls
   `runs.cancel`. Pending approvals stay `awaiting_approval`, and a running bash command finishes.
5. **Medium:**
   - Send is blocked with no expiry while an approval waits.
   - "This answer stopped early" / "Stopped" show on answers that are waiting or running.
   - A second tab's 409 is swallowed (`onDecide` has only `onSettled`).
   - `submitApprovals` isn't transactional (`executor.ts:857-880`).
   - The stale-file guard wastes a prompt.

Patterns to borrow from opencode, in `docs/audits/2026-09-30/opencode-patterns.md`:
- guarded four-state tool parts (pending, running, completed, error), persisted on every transition;
- abort marks leftovers `error` with `interrupted: true` and keeps partial output;
- a double or stale reply gets 404/409, and the client tracks answered IDs;
- reconnect is snapshot-then-events, upserted by ID;
- when an abort drops a pending ask, emit a resolved or cancelled event (opencode doesn't).

## Done when

Within the existing authorization: no policy change, no new auto-approval, no broader access.
- **1. Live cards.** Every policy-required card appears live without a reload, across sequential writes, parallel
  writes in one step, and edit sequences. Resume carries decisions (approval-response parts, or the decided state
  from the run record), so the mapping never drops tool parts. There is a regression test at unit level and a
  two-sequential-writes e2e test using the mock's `[script:…]` from `5d9badc`.
- **2. Reload freshness.** A reload always shows the run's current state. Reconcile the run's pending calls or status
  against the rendered message and refetch when they differ, or don't treat a persisted `messages.path` as fresh
  while a run is active.
- **3. Idempotent decisions.**
  - Deciding one card leaves every other card's state intact: stable keys by `toolCallId`, and "sent" state derived
    from the server, not component state.
  - A decision resumes from the stream cursor, not from 0.
  - The server rejects a decision for an already-decided call with CONFLICT: idempotent for the same decision,
    refused for a flip.
  - `submitApprovals` is atomic (a transaction, or a conditional update on the run's version).
  - A failed decision shows an inline error with Retry.
- **4. Stop.**
  - Stop calls `runs.cancel`.
  - The server cancels a waiting run: pending calls resolve as cancelled, and a resolved/cancelled event is emitted
    so every client drops the card.
  - A running run aborts in-flight tools: bash gets a kill signal and keeps its partial output; leftover calls are
    marked interrupted.
  - The UI shows "Stopped by you" on those calls.
- **5. States.** Clear per-call and per-run states: waiting for your approval, running, done, failed (with the
  reason), stopped, denied. "Stopped early" appears only when the run actually ended early. While an approval
  waits, Send offers "Send (skips the pending change)" or is explained, not silently blocked. If you choose a
  behaviour change here, like auto-denying pending calls when a new message is sent, keep it within the existing
  authorization and document it. A second tab's decision updates the first.
- **6. Stale file.** An edit whose base changed is caught before the prompt when cheap (re-check on resume before
  showing the card, and refresh the diff), or the card says "the file changed since this was proposed".
- **7. Measurement.** Re-run the audit's scenarios (a)–(d′) after the fixes and add an after table to
  `.context/audit-after.md`: total prompts, duplicates/stale, policy-required, hidden until reload, reloads needed.
  Target: duplicates/stale = 0, hidden = 0, reloads = 0, policy-required unchanged.
- **8. E2E.** Create/edit/preview, rapid approval clicks, denial (reject all), cancellation (Stop during a pending
  approval and during a running bash), reconnect (reload mid-run and during a pause), two tabs deciding.
  Gate and e2e pass.

## Owns

`packages/chat-ui/src/{chat/connected-chat.tsx,model/**,conversation/{approval,tool-part,tool-status,message-row,parts}*}`,
`packages/client/src/**`, `packages/server/src/runs/**`, `packages/ai/src/messages/**`, `packages/db/src/queries/runs*`,
`apps/web/app/(app)/_shared/{app-frame.tsx,query-persistence.ts}`, `e2e/**` (not `shell.spec.ts` or `workspace*.spec.ts`
beyond the needed additions), the Lingui catalog. No `packages/contract` changes. If one is required (for example a
cancelled-event shape), stop and write it up for Connor.

## Results

Branch `t/072-harness-reliability` (origin/main plus the audit's `[script:…]` mock commit `6772192`), not pushed; `status` stays `open`. No `packages/contract` or port change was needed, and nothing outside Owns was edited (`app-frame.tsx` is untouched).

**Per finding** (the Done-when numbering):

1. **Live cards.** Two causes, both fixed.
   - `liveParts` (`chat-ui/src/model/live-messages.ts`) takes the stored branch's decisions (`decisionsOn`; `mergeLive` keys its cache on them), falls back to the stream's own yes/no, strips the approval of a call that was stopped undecided, and drops only a part it can't map, never the whole message. Unit tests reproduce the audit's `liveParts([executedApprovedCall, nextRequestedCall])` case. (`b601994`)
   - The server appends a `tool-approval-response` chunk for every recorded decision, before the resumed pass starts, under the approval id the stream asked with (`approvalIdsOf` reads it from the stored request chunk: the SDK makes its own ids, and a response a client can't place fails its whole stream). (`f77c7f4`, `5fa011f`)
   - e2e: three sequential writes, an edit sequence, three parallel writes in one step, all live, no reload.
2. **Reload freshness.** `query-persistence.ts` persists conversation queries invalidated, so a reload renders the cached copy and then refetches (D28's "show it, then revalidate"). A page opened during a pause follows the run's stream, and the chat refetches when the waiting run asks about a call the screen doesn't show. A page that picks a run up keeps the stored answer until the replay has caught up, so cards don't flash away. (`f78eddb`, `f335f6f`, `41c57c9`)
3. **Idempotent decisions.**
   - Tool blocks are keyed by `toolCallId`. The sent state lives in `ConnectedChat` by call (`useDecisions`) and lasts until the server's copy of the call shows it decided; cards read it through `RunActivityProvider` (`conversation/approval-state.tsx`). A sent card stays in place, inert and `aria-busy`, until then (the rapid-click e2e showed a collapsing card scrolled the next card's Approve under the pointer, so a double click decided two changes). (`f335f6f`, `cf80cf6`)
   - A page following the stream no longer resumes after a decision: the open stream carries on from its cursor. Only a page that isn't following resumes, and that one replays from 0 because the SDK rebuilds a resumed answer from an empty message (said in the code).
   - `submitApprovals` runs in one transaction holding the run row (`lockRun`, `SELECT … FOR UPDATE`), resume included, and the resumed pass is claimed before the resume commits, so a cancel in between stops it. The same decision again is a 200 no-op; a different one is `CONFLICT` (the executor's `invalid_state`, which the router already maps to `not_awaiting_approval`), also after the run moved on. (`f77c7f4`, `bac5f6c`)
   - A failed decision shows an inline error with Retry. A `CONFLICT` asks the server once for the run waiting on that call (the list can be stale), then says it was decided elsewhere or the answer stopped.
4. **Stop.**
   - Stop calls `runs.cancel` for the answering run (running or waiting); the page only stops reading on its own if that fails.
   - Cancelling a waiting run gives each pending call a "not run" error result, announced as `tool-output-error` before the stream closes (a terminal run's stream takes nothing more), so every client drops the card, and stored in the cancel's transaction.
   - A cancelled pass passes the abort to its tools (just-bash returns at once; Docker's client already hands the same `signal` to `fetch`). The executor watches tool executions, so a killed command keeps what it printed: leftovers get "Stopped by the user before it finished." plus the output so far. The server unit test kills a fake bash that resolves with partial output on abort.
   - The UI reads it back (`interruptionOf` in `@workspace/ai/messages/approval`) as "Stopped by you" (or "Stopped" when the system stopped it).
5. **States.**
   - **Behaviour change, within the existing authorization.** A new message sent while the answer it follows waits on approvals cancels that answer first, as Stop would: its pending changes resolve as not run and are never applied, and the new turn starts at once (`create-run.ts`, `moveOnFromWaiting`). Before, it queued forever behind the pause. Anyone who may send in the chat may already press Stop. (`d5bb626`)
   - The composer offers Send whenever a card waits and no decision is on its way (read from the cards, not the runs list, which lags); a note under the answer says a new message skips the pending change and has Stop, and the card says so too. A stopped run's leftovers don't count as waiting. (`9f979a6`, `cc64723`)
   - "This answer stopped early" only when the answer's run isn't going; otherwise "Still working on this answer…", "Waiting for your approval." or queued. A call whose run still runs keeps spinning after a reload; a call a stopped run left reads "Stopped by you".
   - A second tab follows the run, so the first tab's decision (and the next card) shows there; a second tab's own 409 is shown, not swallowed.
6. **Stale file.** A pending change whose file's `readFile` etag (SHA-256) no longer matches the proposal's base hash says "{path} changed after the agent proposed this, so the change can't be applied as shown", and offers "Ask for an updated change" (a reject whose reason tells the agent to re-read and re-propose) or Reject, never Approve. It reads through the Files panel's own query, so a save there re-checks the card at once. The cheaper-still option (the server re-proposing on resume) needs the turn's sandbox in `submitApprovals`; left for later. (`c97be6b`)
7. **Measurement.** `.context/audit-after.md` has the before/after table and probes. Summary:

   | task | prompts before → after | duplicates/stale before → after | policy-required | hidden before → after | reloads before → after |
   |---|---|---|---|---|---|
   | (a) sequential site | 3 → 3 | 0 → 0 | 3 (unchanged) | 2 → 0 | 3 → 0 |
   | (a') one-step site | 18 mounts → 3 | 15 re-mounts + 5 dup POSTs → 0 | 3 (unchanged) | 0 → 0 | 0 → 0 |
   | (b) edit twice | 2 → 2 | 0 → 0 | 2 (unchanged) | 1 → 0 | 1 → 0 |
   | (c) scaffold | 3 → 3 | 0 → 0 | 3 (unchanged) | 2 → 0 | 4 → 0 |
   | (d) re-read + rewrite | 1 → 1 | 0 → 0 | 1 (unchanged) | 0 → 0 | 0 → 0 |
   | (d') edit while pending | 2–3 → 2 | 1 wasted approval of a stale diff → 0 | 2 (unchanged) | 1 → 0 | 2 → 0 |

   Wall time with the mock fell from 48 s / 64 s to under 2 s for (a) / (c); stream subscriptions per task from 3–7 to 1.
8. **E2E.** `e2e/tests/harness.spec.ts` (10 tests): sequential writes, an edit sequence, parallel writes with rapid clicks, reject all, Stop during a pending approval (also dropping the card in a second tab and after a reload), Stop during a running `sleep 30` (killed within seconds), reloads the moment a decision lands, during a pause and mid-command, two tabs deciding (including both at once), a new message while a change waits, and a file edited in the Files panel while its change waits. (`16e1265`)

**Tests.** Server `harness-reliability.test.ts` (decisions announced once and before the resumed pass; repeat 200, flip 409, also after the run moved on; two concurrent decisions both kept and one resume; cancel resolves waiting calls on the stream and in the answer; a running command is aborted and keeps its output; a new message moves on; the pure helpers). `runs.test.ts`'s re-decide expectation now matches the idempotency rule. chat-ui: `live-messages`, `run-activity`, `approval` (stale edits), `tool-part` (sent card inert, Retry, conflict, stopped, stale), `parts` (stable keys). web: `query-persistence` (restored invalidated).

**Found while measuring, fixed:** the approval-id mismatch (`5fa011f`), a double click deciding the next card (`cf80cf6`), a reopened page flashing its card away during the replay (`41c57c9`), Send waiting for the runs list (`9f979a6`), the waiting note outliving a stop (`cc64723`), and a cancel racing a resume (`bac5f6c`).

**Checks.**
- `gate.sh`: install unchanged, check and guards clean, `turbo typecheck lint test build` 82/82 (one earlier gate run had `@workspace/db#test` fail under load average ~120; it passes alone and passed on the rerun).
- `E2E_PORT=3553 bun turbo test:e2e`: 43/43 (33 before plus the 10 in `harness.spec.ts`), on the final commit.
- Package suites: server 210/210, ai 296/296, db 68/68 (+1 skipped), client 13/13, chat-ui model/conversation/chat all green.

**Notes and left for later.**
- "Stopped by you" is shown for any person's Stop: the interruption text says a user stopped it, not which one. In a shared chat the other person also reads "Stopped by you"; naming who would need the run's `cancelledBy` next to the message.
- A stale change is caught and explained, not re-proposed by the server: that would need the turn's sandbox inside `submitApprovals`. The agent re-proposes after "Ask for an updated change".
- `approvalIdsOf` reads the run's `tool-approval-request` chunks with a `jsonb` filter on every decision; fine at chat scale, but an index or caching the ids on the run row would help a very long run.
- The measurement spec (`zz-audit-harness.spec.ts`, adapted from the audit's) isn't committed, like the audit's.
- Nothing needs a contract change or a decision from Connor, except that the new-message behaviour (a message sent while a change waits skips it) is a product choice he may want to confirm.

## Resolution (2026-09-30, loop)

Merged on Connor's decision (2026-09-30), keeping cancel-on-send: a new message sent while a change waits cancels that answer. Verified on the rebased branch: gate 82/82, e2e 43/43. [PR #63](https://github.com/connorwforsyth/openchat/pull/63).
