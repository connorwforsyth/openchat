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
| `OneRunPerBranch` | No turn runs while an answer above it on its branch is still being written. | A turn answers from a half-written answer, and two answers stream on one branch. |
| `NoStuckRun` | Once every request has returned and no pass executes, each run has ended, is paused for approval, or is queued behind a run that hasn't ended. | A turn never gets answered, and every later turn on the branch queues behind it until the server restarts (`recover`). |
| `SettledOnce` | `onSettled` (usage, prune and title jobs) fires at most once per run. | Duplicate jobs, and usage recorded against a run the user stopped. |
| `OnePassPerRun` | At most one pass of a run executes at a time. | Two answers for one run. |

## Run it

```sh
bun .claude/skills/verify-run-queue/model/check.ts              # the default checks
bun .claude/skills/verify-run-queue/model/check.ts queue        # checks by name
```

It needs no model provider, database or network once the tools are cached. The first run downloads tla2tools.jar 1.7.4, plus a Temurin 21 JRE if no `java` is on PATH, into `~/.cache/tla-tools`, and checks both against pinned SHA-256 sums (`$JAVA` overrides). The default checks explore about 950,000 states. That took 45 s of TLC on an M1 Pro under moderate load, and about 4 minutes when other jobs held the CPU; `stop-stranded` and `queue` take most of it.

It prints one line per check (`ok` or `FAIL`, expected against got), then each counterexample as numbered steps in the code's words, with every run's status after each step. It exits 0 only when every check matches the table below.

## Recorded results

Last confirmed against the last commit that changed `model/`: a model change lands in the same commit as the code it describes, so that commit is the sync point. Each `violated` row is a finding in the current code. The `queue` check is the regression guard: it holds, so a change that breaks sending, queueing or finishing shows up there even while the findings stand.

| Check | Config | Property | Expected | Trace |
| --- | --- | --- | --- | --- |
| `queue` | SendOnly | all but `StopReachesPass` | holds | about 285,000 distinct states |
| `double-start` | SendOnly | `StopReachesPass` | violated | finding 1, 15 steps |
| `stop-start` | Stop | `EndedRunsAreIdle` | violated | finding 2, 6 steps |
| `stop-branch` | Stop | `OneRunPerBranch` | violated | finding 2, 11 steps |
| `stop-settled` | Stop | `SettledOnce` | violated | finding 2, 11 steps |
| `stop-stranded` | Stop | `NoStuckRun` | violated | finding 4, 21 steps |
| `stop-approval` | StopApproval | `EndedRunsAreIdle` | violated | finding 3, 12 steps |
| `approval-lost` (slowest; run by name) | Approvals | `NoStuckRun` | violated | finding 1, 27 steps |

## Findings in the current code

1. **A run started twice loses its controller.** A turn queued behind a run that finishes just as the turn is sent gets two `startRun` calls: one from its own `createRun` (`executor.start`), one from the finished run's `promoteAfter`. Both pass their checks.
   - Each call does `active.set(run.runId, controller)`. One claim wins, and the loser's `active.delete(run.runId)` removes whatever is there.
   - The executing pass's controller is now gone, so Stop aborts the wrong controller or none (`double-start`).
   - `approval-lost` shows the rarer consequence. If the losing claim's reply lands after the run has paused and a decision has registered its controller, that controller is deleted too. `submitApprovals` then starts no pass, and the run stays `running` with nothing executing. That needs the losing claim to take as long as a whole pass.
2. **Stop on a run that is starting cancels it under its pass.** `cancel` reads the run as `queued` and finds no controller, so it calls `cancelIdle`. Then `startRun` claims the run and its pass starts. `cancelIdle`'s `transitionRun(cancel)` still succeeds, because `FROM.cancel` includes `running`.
   - The pass runs to the end on a cancelled run (`stop-start`).
   - The run looks finished, so a turn sent after it starts at once while the zombie pass is still writing the answer above it (`stop-branch`).
   - When the zombie settles, its compare-and-set loses, and `settleLostRace` runs `finishTerminal` a second time, firing `onSettled` again (`stop-settled`).
3. **Stop on the approval card races the decision.** `cancel` reads `awaiting_approval` with no controller. The decision then sets its controller, resumes and commits. `cancelIdle` cancels the now-`running` run, and `submitApprovals` starts the resumed pass anyway, so the approved tool calls execute after Stop (`stop-approval`).
4. **Stopping a queued turn can strand the turn behind it.** `cancelIdle` reads that the run ahead is still active. That run then finishes, and its `promoteAfter` finds nothing behind it. `requeueAfter` then moves the waiting turn behind the finished run, where nothing will ever start it (`stop-stranded`).

## When you change covered code

1. **Scope.** Diff the covered files against the sync commit:

   ```sh
   git diff "$(git log -1 --format=%H -- .claude/skills/verify-run-queue/model)" -- packages/server/src/runs/executor.ts packages/server/src/runs/create-run.ts packages/db/src/queries/runs.ts packages/db/src/schema/chat.ts
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
| `packages/server/src/runs/executor.ts` | `startRun`, `claim` | `startRun`: `S_Read`, `S_Ahead`, `S_Claim` |
| | `execute` (and its `finally`), `settle`, `settleLostRace`, `track` | `Pass`: `P_Loop`, `P_Settle`, `P_Lost`, `passFinally` |
| | `finishTerminal`, `promoteAfter` | `finishTerminal`: `F_List`, `F_Loop` |
| | `cancel`, `abortPass`, `cancelIdle` | `Stop`: `K_Read` to `K_Wait2` |
| | `submitApprovals`, `recordDecisions`, `storeDecisions` | `Decide`: `D_Lock` to `D_Spawn` |
| `packages/server/src/runs/create-run.ts` | `createRun`, `placeRun`, `busyTail` | `Send`: `W_Read`, `W_Insert`; `BusyTailOf` |
| `packages/db/src/queries/runs.ts` | `FROM`, `TARGET`, `transitionRun`, `listActiveRuns`, `listQueuedAfter`, `requeueAfter`, `lockRun` | `From`, `Target`, `Oldest`, `ByCreated`, `K_Requeue`, `D_Lock` |
| `packages/db/src/schema/chat.ts` | `ACTIVE_RUN_STATUSES` | `ActiveSt` |

`P_Loop` also stands for the awaits `execute` makes before the agent loop: `loadBranch`, `resolveTurn` (`packages/server/src/runs/turn.ts` and its wrappers), `setRunResolvedModel` and `attachmentsForModel`. They read the branch and build the turn but never start, cancel, settle or claim a run, so `turn.ts` is not diffed in step 1. A change there needs the model only if it starts touching run status, `active` or `running`.

## Model conventions

- **One label per await.** A label is one database statement or transaction taking effect, plus the synchronous JavaScript that handles its result up to the next await. Synchronous code never interleaves (one JavaScript thread), so code between two awaits stays in one label. A new await splits a label.
- **Postgres.** READ COMMITTED. A transaction's writes land together at commit, and reads inside it see other commits. `lockRun`'s `FOR UPDATE` is `locked`: writers to that row wait, readers don't.
- **Executor memory.** The executor's maps are `active` and `running`. Controllers are numbered per run, and `aborted` holds those `abort()` was called on. `spawned` holds passes in their agent loop; `P_Loop` ends the loop and picks the outcome. A failed outcome lands like a succeeded one here, so it is left out.
- **Ghosts.** `ansAbove`, `parent` and `settled` feed only the properties. Each check's `VIEW` (in `RunQueue.tla`) drops data no later step reads, and must keep every ghost its property reads.
- **Translation.** `RunQueue.tla` keeps its PlusCal untranslated, and `check.ts` translates a scratch copy on every run. Edit the algorithm and the definitions, and leave the `BEGIN`/`END TRANSLATION` markers empty.
- **Configs.** The `.cfg` files set the bounds; `check.ts` adds `VIEW` and `INVARIANTS`. A request that can never return shows up as a TLC deadlock, which `check.ts` counts against `NoStuckRun`.

## Bounds and what this does not cover

Bounds per config:

| Config | Turns | Stops | Decisions | Pauses | Anchors |
| --- | --- | --- | --- | --- | --- |
| SendOnly | 3 | 0 | 0 | 0 | any run's last message, or a new branch |
| Stop | 3 | 1, on any unfinished run | 0 | 0 | the end of the branch |
| StopApproval | 1 | 1, on the approval card | 1 | 1 | the end of the branch |
| Approvals | 3 | 0 | 1 | 1 | the end of the branch |

A check that holds vouches for these bounds only. The model does not cover:
- `recover` and `shutdown`, crashes, timeouts and thrown errors;
- several executors (the Collaboration wave's `apps/worker`);
- regenerate turns and idempotency-key retries;
- `moveOnFromWaiting`'s own cancel (a Stop stands for it; in the Approvals config sends never cancel);
- the stream channel's chunks (`append`, `close`, `subscribe`) and message parts.

It also never puts another request between a statement taking effect and the code that handles its result: that window is a single network hop.
