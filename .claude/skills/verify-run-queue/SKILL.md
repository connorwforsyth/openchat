---
name: verify-run-queue
description: Model-checks the branch run queue and Stop with TLA+ (one run per branch, queued turns, approval pauses). Use when a change touches startRun, claim, execute/settle, finishTerminal, promoteAfter, cancel, cancelIdle or submitApprovals in packages/server/src/runs/executor.ts; placeRun or busyTail in packages/server/src/runs/create-run.ts; or transitionRun's FROM table, listActiveRuns, listQueuedAfter, requeueAfter or lockRun in packages/db/src/queries/runs.ts. Also when asked whether Stop, queueing or approvals can race.
---

# Verify the run queue

`model/RunQueue.tla` is a PlusCal model of one conversation driven by concurrent requests through the in-process executor and Postgres (PLAN.md D4, D25): turns sent (`createRun`), the queue that keeps one run per branch, passes settling and promoting the run behind them, Stop (`executor.cancel`) and approval decisions (`submitApprovals`). TLC tries every order of their steps within the bounds below. Each label in the model is one await boundary in the code, and its comment quotes the code it stands for.

## Properties

| Property | Holds when | Harm when broken |
| --- | --- | --- |
| `EndedRunsAreIdle` | Once a run has ended or paused, nothing is still calling the model or running tools for it. | Stop is ignored: the answer keeps generating and spending, approved tools run after Stop, and its message is overwritten after the cancel. |
| `StopReachesPass` | While a pass is in its agent loop, `active` holds that pass's controller. | Stop can't abort that answer. |
| `NoLoopAfterStop` | A pass that Stop aborted before its agent loop began never begins it. | The model is called, and a call someone just approved runs, after Stop. |
| `StopTakesEffect` | Once Stop has returned, its run has ended, or the controller `active` holds for it is one Stop aborted. | Stop reports success, or `CONFLICT run_finished`, while the run keeps going or stays stuck. |
| `StopReturns` | Every Stop returns, given weak fairness per process. A temporal property: the invariants can't see a Stop that looks again forever. | The Stop request hangs, and the run it was for stays where it was. |
| `OneRunPerBranch` | No turn runs while an answer above it on its branch is still being written. | A turn answers from a half-written answer, and two answers stream on one branch. |
| `NoStuckRun` | Once every request has returned and no pass executes, each run has ended, is paused for approval, or is queued behind a run that hasn't ended. | A turn never gets answered, and every later turn on the branch queues behind it until the server restarts (`recover`). |
| `SettledOnce` | `onSettled` (usage, prune and title jobs) fires at most once per run. | Duplicate jobs, and usage recorded against a run the user stopped. |
| `OnePassPerRun` | At most one pass of a run executes at a time. | Two answers for one run. |

## Run it

```sh
bun .claude/skills/verify-run-queue/model/check.ts              # every check
bun .claude/skills/verify-run-queue/model/check.ts queue        # checks by name
```

It needs no model provider, database or network once the tools are cached. The first run downloads tla2tools.jar 1.7.4, plus a Temurin 21 JRE if no `java` is on PATH, into `~/.cache/tla-tools`, and checks both against pinned SHA-256 sums (`$JAVA` overrides). The checks explore about 14 million states, in about 8 minutes of TLC on a loaded M1 laptop and about 10 in CI. `stop-branch` takes the longest; `stop-start`, `stop-settled` and `stop-stranded` each explore the whole Stop configuration too.

It prints one line per check (`ok` or `FAIL`, expected against got), then each counterexample as numbered steps in the code's words, with every run's status after each step. It exits 0 only when every check matches the table below.

CI runs every check in the `model (run queue)` job of `.github/workflows/ci.yml` whenever a pull request touches the covered files, this skill or `ci.yml`. A finding recorded `violated` passes there until its fix lands. The fix then fails the job until it flips `expect` to `holds`, and from then on the job enforces it.

## Recorded results

Last confirmed against the last commit that changed `model/`: a model change lands in the same commit as the code it describes, so that commit is the sync point. A `violated` row would be a finding in the current code; none is open. The `queue` check is the regression guard: it holds, so a change that breaks sending, queueing or finishing shows up there even while the findings stand.

| Check | Config | Property | Expected | Trace |
| --- | --- | --- | --- | --- |
| `queue` | SendOnly | all but `StopReachesPass` | holds | 213,074 distinct states |
| `double-start` | SendOnly | `StopReachesPass` | holds | finding 1, fixed; 58,667 distinct states |
| `stop-start` | Stop | `EndedRunsAreIdle`, `NoLoopAfterStop` | holds | finding 2, fixed; 2,567,191 distinct states |
| `stop-branch` | Stop | `OneRunPerBranch` | holds | findings 5 and 6, fixed; 5,747,176 distinct states |
| `stop-settled` | Stop | `SettledOnce` | holds | finding 2, fixed; 2,567,191 distinct states |
| `stop-stranded` | Stop | `NoStuckRun` | holds | finding 4, fixed; 2,567,191 distinct states |
| `stop-approval` | StopApproval | `EndedRunsAreIdle`, `NoLoopAfterStop` | holds | finding 3, fixed; 116 distinct states |
| `stop-pause` | StopPause | `StopTakesEffect`, `NoLoopAfterStop`, `EndedRunsAreIdle` | holds | finding 7, fixed; 176 distinct states |
| `stop-pause-again` | StopPauseAgain | `StopTakesEffect`, `NoLoopAfterStop`, `EndedRunsAreIdle` | holds | finding 8, fixed; 316 distinct states |
| `stop-orphan` | StopCrash | `StopTakesEffect`, `EndedRunsAreIdle`, `NoLoopAfterStop` | holds | finding 2's crashed pass, fixed; 10,130 distinct states |
| `stop-returns` | StopCrash | `StopReturns` | holds | finding 2's crashed pass, fixed; 9,666 distinct states |
| `approval-lost` | Approvals | `NoStuckRun` | holds | finding 1, fixed; 337,111 distinct states |

## Findings

`executor.races.test.ts` (next to `executor.ts`) replays each finding's interleaving against PGlite by holding requests at the awaits its trace names.

1. **A run started twice loses its controller.** A turn queued behind a run that finishes just as the turn is sent gets two `startRun` calls: one from its own `createRun` (`executor.start`), one from the finished run's `promoteAfter`. Both pass their checks.
   - Each call does `active.set(run.runId, controller)`. One claim wins, and the loser's `active.delete(run.runId)` removes whatever is there.
   - The executing pass's controller is now gone, so Stop aborts the wrong controller or none (`double-start`).
   - `approval-lost` shows the rarer consequence. If the losing claim's reply lands after the run has paused and a decision has registered its controller, that controller is deleted too. `submitApprovals` then starts no pass, and the run stays `running` with nothing executing. That needs the losing claim to take as long as a whole pass.
   - **Fixed.** The claim's compare-and-set is the only gate. `claim` sets `active` inside its transaction once its `transitionRun(start)` has won, so a losing claim never touches it, and `execute`'s `finally` releases only its own controller. `submitApprovals` starts the resumed pass with the controller it registered rather than reading `active` back.
2. **Stop on a run that is starting cancels it under its pass.** `cancel` reads the run as `queued` and finds no controller, so it calls `cancelIdle`. Then `startRun` claims the run and its pass starts. `cancelIdle`'s `transitionRun(cancel)` still succeeds, because `FROM.cancel` includes `running`.
   - The pass runs to the end on a cancelled run (`stop-start`).
   - The run looks finished, so a turn sent after it starts at once while the zombie pass is still writing the answer above it (`stop-branch`).
   - When the zombie settles, its compare-and-set loses, and `settleLostRace` runs `finishTerminal` a second time, firing `onSettled` again (`stop-settled`).
   - **Fixed.** A `running` run has a pass, and only that pass ends it. `FROM.cancel` is now `queued` or `awaiting_approval`, and a pass Stop aborted settles with its own transition, `abort` (`running` to `cancelled`). A `cancelIdle` that loses to a claim looks again, and `abortPass` finds the claim's controller because the claim took `active` before its commit. With nothing else able to move a `running` run, `settleLostRace` (the second `finishTerminal`) is gone: a pass that loses its own transition reports it. `stop-start` and `stop-settled` guard this; `stop-branch` now fails on finding 5 instead.
   - **The crashed pass.** That fix left one `running` run with no pass: one whose pass threw and whose `failEarly` threw too. Stop found no controller, `cancelIdle` couldn't move it, and Stop answered `CONFLICT run_finished` while the branch stayed blocked until a restart (`stop-orphan`, 8 steps). The same happened when the pass crashed while Stop waited on it, or between `cancelIdle` losing and the next `abortPass` (9 steps).
   - **Fixed.** `cancelIdle` locks the run (`lockRun`) and, when it is `running` with nothing in `active`, ends it with `abort`. A claim or a decision sets `active` before its commit and a decision takes the same lock, so under the lock a `running` run with nothing in `active` has no pass in this process. Stop is now one loop: abort the pass here, or `cancelIdle`, and look again after a look that loses, until the run has ended or a controller Stop aborted holds it. Stop returns `invalid_state` only for a run that had ended when it came.
   - **Guarded by `stop-returns`.** Without the `abort` branch, Stop on the crashed pass's run looks again forever: `cancelIdle` can't cancel a `running` run and nothing is in `active` to abort. That Stop never returns, so `stop-orphan` still holds; `stop-returns` fails with a trace that ends in Stop going from `K_Idle` to `K_Again` and back, forever.
3. **Stop on the approval card races the decision.** `cancel` reads `awaiting_approval` with no controller. The decision then sets its controller, resumes and commits. `cancelIdle` cancels the now-`running` run, and `submitApprovals` starts the resumed pass anyway, so the approved tool calls execute after Stop (`stop-approval`).
   - **Fixed.** The cancel can't move the resumed run, so `cancel` aborts the decision's controller instead. The resumed pass then starts already aborted. The AI SDK still executes approved calls under an aborted signal, so `execute` checks the signal before `runAgent` and settles as cancelled without calling it (`P_Begin`, `NoLoopAfterStop`).
   - `cancelIdle` used to announce the stopped calls before its transaction, so a cancel that lost to the decision still showed every client the card as stopped. It now writes those chunks (`appendRunChunks`) in the cancel's own transaction: they land only if the cancel does, and a subscriber reads them in its last drain before the end. The model leaves chunks out, so `executor.races.test.ts` covers this.
4. **Stopping a queued turn can strand the turn behind it.** `cancelIdle` reads that the run ahead is still active. That run then finishes, and its `promoteAfter` finds nothing behind it. `requeueAfter` then moves the waiting turn behind the finished run, where nothing will ever start it (`stop-stranded`).
   - **Fixed.** `cancelIdle` no longer reads the run ahead. It moves the waiting turns behind it with `requeueAfter`, finishes the cancelled run, then calls `startRun` on each. A turn whose run ahead ended meanwhile starts there. If that run ends later, its `promoteAfter` reads after the move and finds the turn. When both try, the claim lets one win (finding 1).
5. **A reply under a stopped queued question skips the queue.** A turn is queued behind a run still answering, and Stop cancels it. The next turn replies under that cancelled question, the end of the branch. `busyTail` matches only an active run whose own message is the anchor, and the cancelled run isn't active, so the reply starts at once while the answer above it is still being written (`stop-branch`). It is in `placeRun`, not Stop.
6. **A turn queued behind a stopped queued turn can start early.** Turn L waits behind S, which waits behind F, still answering. L's own `startRun` reads S as the run ahead, then Stop cancels S before that `startRun` reads S's status. L sees S ended and claims, while F is still writing the answer above it. `cancelIdle`'s `requeueAfter` then moves only queued turns, so L stays running. It shares finding 5's root (a run cancelled before it ran still holds a place in the branch). TLC stops at finding 5 first; with only finding 5 fixed, `stop-branch` finds this one in 13 steps.
   - **Fixed, both.** A run that ended before it ran (no `assistantMessageId`) passes its place on. `placeRun` queues a turn sent under such a question behind its run (`stoppedRunAt`), still under that question, when nothing active is there. `startRun` that finds its run ahead ended before it ran calls `requeueAfter` on it, as `cancelIdle` does, and starts each run it moved, so the turn waits on the run that was ahead of the stopped one. That also covers a turn placed behind a run after `cancelIdle` already moved the queue (`S_Requeue`, `S_Each`, `W_Held`). `executor.races.test.ts` (finding 6) and `runs.test.ts` (finding 5) replay both.
7. **Stop misses a pass that a decision resumes right after its pause.** Stop aborts a pass that has already asked for approval. The pass still settles as `awaiting_approval`, and a decision resumes it before Stop's second `getRun`. Stop sees `running`, returns, and the resumed pass runs the approved call and calls the model (`stop-pause`).
   - **Fixed.** Stop looks again after every look that loses (finding 2's loop): the next look aborts the controller in `active`, so the resumed pass starts already aborted and settles as cancelled without calling `runAgent` (finding 3).
8. **Stop loses to a pass that pauses after its cancel lost.** Stop reads the run waiting on the card (or queued) and calls `cancelIdle`. A decision (or a claim) commits first, and the pass it starts asks for approval again. `cancelIdle` loses, and the pass settles `awaiting_approval` either before Stop's fallback `abortPass`, which finds no controller and answers `CONFLICT run_finished`, or after it, as finding 7's pause does. Either way the run waits on a new card after Stop (`stop-pause-again`: 10 steps from a queued run; 16 steps with Stop only on the card). The fallback path has no look after the pass, which the first path got in finding 7.
   - **Fixed.** Stop has no fallback path any more. It looks again after any look that loses, so the next look cancels the new pause (finding 2's loop).

## When you change covered code

1. **Scope.** Diff the covered files against the sync commit:

   ```sh
   git diff "$(git log -1 --format=%H -- .claude/skills/verify-run-queue/model)" -- packages/server/src/runs/executor.ts packages/server/src/runs/create-run.ts packages/db/src/queries/runs.ts packages/db/src/schema/chat.ts packages/server/src/runs/state.ts packages/contract/src/schemas/runs.ts
   ```

   A hunk in a function listed under Coverage means the model needs a look. Hunks elsewhere in those files (turn resolution, attachments, stream parts) don't.
2. **Mirror.** Change the labels that stand for the changed code so they do what the code now does. Follow the step rule under Model conventions. A fix for a finding is a change like any other: mirror it, then expect that check to flip.
3. **Run** `check.ts`. Done when every line reads `ok`, or every `FAIL` is classified in step 4.
4. **Classify** each `FAIL` by walking its narrated trace against the code, step by step:
   - **Real bug:** every step maps to code that can run in that order, with another request free to run at each await. Report it with the narrated trace. Keep the property and the bounds as they are; the trace is the finding.
   - **Modeling error:** some step has no counterpart, or the model splits one synchronous block into two labels, or it misses a guard the code has. Fix the model, then rerun.
   - **Fixed finding:** a `violated` check now holds. Confirm it is the fix, not a model slip. A check that holds explores its whole configuration, so it takes longer.
5. **Record.** Update `expect` in `CHECKS` in `model/check.ts`, the Recorded results table, and Findings. Commit the model with the code it describes, never ahead of it: that commit becomes the sync point.

## Coverage

| Code | Functions | Model |
| --- | --- | --- |
| `packages/server/src/runs/executor.ts` | `startRun`, `claim` | `startRun`: `S_Read`, `S_Ahead`, `S_Requeue`, `S_Each`, `S_Next`, `S_Claim` |
| | `execute` (and its `finally`), `settle`, `track`, `release` | `Pass`: `P_Begin`, `P_Loop`, `P_Settle`, `passFinally` |
| | `finishTerminal`, `promoteAfter` | `finishTerminal`: `F_List`, `F_Loop` |
| | `cancel`, `abortPass`, `cancelIdle`, `startEach` | `Stop`: `K_Read` to `K_Again` |
| | `submitApprovals`, `recordDecisions`, `storeDecisions` | `Decide`: `D_Lock` to `D_Spawn` |
| `packages/server/src/runs/create-run.ts` | `createRun`, `placeRun`, `busyTail` | `Send`: `W_Read`, `W_Held`, `W_Insert`; `BusyTailOf` |
| `packages/db/src/queries/runs.ts` | `FROM`, `TARGET`, `transitionRun`, `listActiveRuns`, `stoppedRunAt`, `listQueuedAfter`, `requeueAfter`, `lockRun` | `From`, `Target`, `Oldest`, `ByCreated`, `W_Held`, `K_Requeue`, `S_Requeue`, `D_Lock` |
| `packages/db/src/schema/chat.ts` | `ACTIVE_RUN_STATUSES` | `ActiveSt` |
| `packages/server/src/runs/state.ts` | `isTerminal`, `runStartFromRow` | `Terminal`; the run `startRun` reads |
| `packages/contract/src/schemas/runs.ts` | `terminalRunStatuses`, `isTerminalRunStatus` | `Terminal`; `W_Held` (`stoppedRunAt` reads it) |

`P_Begin` also stands for the awaits `execute` makes before the agent loop: `loadBranch`, `resolveTurn` (`packages/server/src/runs/turn.ts` and its wrappers), `setRunResolvedModel` and `attachmentsForModel`. They read the branch and build the turn but never start, cancel, settle or claim a run, so `turn.ts` is not diffed in step 1. A change there needs the model only if it starts touching run status, `active` or `running`.

## Model conventions

- **One label per await.** A label is one database statement or transaction taking effect, plus the synchronous JavaScript that handles its result up to the next await. Synchronous code never interleaves (one JavaScript thread), so code between two awaits stays in one label. A new await splits a label. One exception: `S_Each` and `S_Next` split a recursive `startRun` call from taking the next run, because PlusCal re-initialises the caller's locals in the call step. That split touches only locals, so it adds no interleaving another request could see.
- **Postgres.** READ COMMITTED. A transaction's writes land together at commit, and reads inside it see other commits. `lockRun`'s `FOR UPDATE` is `locked`: writers to that row wait, readers don't.
- **Executor memory.** The executor's maps are `active` and `running`. Controllers are numbered per run, and `aborted` holds those `abort()` was called on. A controller enters `active` only in the step whose claim or resume wins. `spawned` holds a pass's controller from `track()` until its agent loop ends: `P_Begin` checks the abort and starts `runAgent`, and `P_Loop` ends the loop and picks the outcome. A failed outcome lands like a succeeded one here, so it is left out. In StopCrash a pass may instead crash: it leaves its loop and runs its `finally` with the run still `running`, as when `failEarly` throws.
- **Ghosts.** `ansAbove`, `parent`, `settled`, `begun` and `stoppedEarly` feed only the properties. Each check's `VIEW` (in `RunQueue.tla`) drops data no later step reads, and must keep every ghost its property reads.
- **Translation.** `RunQueue.tla` keeps its PlusCal untranslated, and `check.ts` translates a scratch copy on every run. Edit the algorithm and the definitions, and leave the `BEGIN`/`END TRANSLATION` markers empty.
- **Fairness.** `CheckedSpec` gives each process weak fairness (`Fairness`): a request or pass that can take its next step eventually does. TLC uses it only for `PROPERTIES`, so the invariant checks are unchanged by it.
- **Configs.** The `.cfg` files set the bounds; `check.ts` adds `VIEW`, `INVARIANTS` and `PROPERTIES`. A request that can never return shows up as a TLC deadlock, which `check.ts` counts against `NoStuckRun`.

## Bounds and what this does not cover

Bounds per config:

| Config | Turns | Stops | Decisions | Pauses | Anchors |
| --- | --- | --- | --- | --- | --- |
| SendOnly | 3 | 0 | 0 | 0 | any run's last message, or a new branch |
| Stop | 3 | 1, on any unfinished run | 0 | 0 | the end of the branch |
| StopApproval | 1 | 1, on the approval card | 1 | 1 | the end of the branch |
| StopPause | 1 | 1, on the running pass | 1 | 1 | the end of the branch |
| StopPauseAgain | 1 | 1, on any unfinished run | 1 | 2 | the end of the branch |
| StopCrash | 2 | 1, on any unfinished run | 0 | 0 | the end of the branch; one pass may crash |
| Approvals | 3 | 0 | 1 | 1 | the end of the branch |

A check that holds vouches for these bounds only. The model does not cover:
- `recover` and `shutdown`, timeouts, and crashes other than a pass that throws and can't fail its run (StopCrash);
- several executors (the Collaboration wave's `apps/worker`);
- regenerate turns and idempotency-key retries;
- `moveOnFromWaiting`'s own cancel (a Stop stands for it; in the Approvals config sends never cancel);
- the stream channel's chunks (`append`, `close`, `subscribe`) and message parts.

It also never puts another request between a statement taking effect and the code that handles its result: that window is a single network hop.

`P_Begin` takes `execute`'s abort check and the start of the agent loop as one step. Between them `runAgent` and the AI SDK's `streamText` (ai 7.0.116) await only local work before they execute approved calls: `convertToModelMessages`, `standardizePrompt`, `notify` and `validateApprovedToolApprovals`, with no I/O. So no other request runs in between. An SDK version, an `onStart` hook or a tool input check that does I/O there would let a Stop land after the check and before the approved calls, which execute even under an aborted signal.
