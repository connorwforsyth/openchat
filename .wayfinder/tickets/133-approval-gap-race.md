---
id: "133"
title: "A message sent just after an approval card appears can queue behind a run that then waits forever"
labels: [wayfinder:build]
status: closed
assignee:
blockedBy: []
---

## Question

Found while fixing 132. The approval card is streamed while the run is still `running`; the run only becomes `awaiting_approval` after its pass ends (`packages/server/src/runs/executor.ts` ~610–640). `moveOnFromWaiting` in `runs/create-run.ts` only cancels `awaiting_approval` runs, so a message sent in that gap isn't treated as moving on. The new turn queues behind a run that then waits for approval indefinitely. A probe caught the run still `running` in 5/12 tries, and 4/12 ended stuck as `[queued, awaiting_approval]`. This is what makes `harness.spec` "a new message while a change waits skips the change" flaky (10/20 under load with 4 workers).

## Done when

- A new message sent while an approval card is pending, whether the run is `running` with a pending approval or `awaiting_approval`, moves on: it cancels or skips the pending change, as #63 decided.
- A deterministic server test for the gap, and the harness spec passes 20/20 under load.

## Results (2026-10-02, loop)

Branch `t/133-approval-gap` (not pushed). Server only; no contract or port changes.

**Root cause.** Two gaps, not one. (1) The card is streamed while the run is
still `running`; it only becomes `awaiting_approval` when the pass settles
(after `proposeEdits`, which can be slow). `moveOnFromWaiting` only looked
for `awaiting_approval`, so a message sent off a visible card queued behind
the run. (2) Even when something did cancel a run in that window,
`executor.cancel` aborted the pass and returned ok, but a pass that already
had its outcome settled as `awaiting_approval` anyway. Stop in that gap had
the same hole.

**Fix.**
- `create-run.ts`: `waitsOnSomeone(run)` is true for `awaiting_approval`, or
  for `running` when the run's stored stream has a `tool-approval-request`
  whose call has no decision on the answer yet. Decisions are written with
  the resume in one transaction, so a resumed pass doesn't count until it
  asks again. The card is persisted (`run_chunk`) before any client can see
  it, so a message sent off a visible card always finds it. A message sent
  before any card still queues (D25).
- `executor.ts` `cancel`: after aborting a pass, if the run ended up
  `awaiting_approval` with nothing executing, it's cancelled through
  `cancelIdle` (pending calls stopped, stream closed, queue promoted). If a
  decision resumed it meanwhile, that pass is aborted too.
- Why not the other options: marking `awaiting_approval` mid-pass would let
  a decision resume a run whose pass is still settling; a self-check in the
  executor after settling would also cancel for turns queued *before* the
  card, which changes D25, and needs a second race guard on the create side.
  Recovery is unchanged: `recover()` still keeps `awaiting_approval` runs.

**Tests.**
- `harness-reliability.test.ts` "a new message in the gap before a run
  pauses (133)": the pass held after the card in the model stream and in
  settle (`proposeEdits`). Both failed before (run ended `awaiting_approval`,
  turn queued); the settle case also fails with only the create-run change.
  Plus a decided change still queues the next turn. Harness `TurnScript`
  gained `proposeEdits`. Server suite 55 files / 550 tests pass; new tests 5/5 repeat runs.
- e2e "a new message while a change waits skips the change": 0 failures
  across two full `harness.spec --repeat-each=20 --workers=4` runs (15/15 that
  ran each time; the rest skipped by serial mode after other tests failed),
  and 20/20 with `--grep` for that test. Baseline on the pre-fix server: 2 failures out of 17 that ran.
- Rest of `harness.spec` under that load is still flaky in the **client**,
  the same with and without this change (baseline 1 + 2, fix 2 + 3, 2 + 1):
  "Stop while a change waits…" (the second tab keeps its card, line 279) and
  "a reload mid-run or during a pause…" (the script.js card stays after
  approving). Both look like chat-ui stream/resume issues; not touched here.
- `gate.sh`: check, guards, evals green; turbo 93/93 (first run had a
  chat-ui browser test flake under load, green alone and on rerun). Full
  e2e: 87 passed, 3 failed (composer ×2, skills ×1), all passing on rerun.
