---
id: "133"
title: "A message sent just after an approval card appears can queue behind a run that then waits forever"
labels: [wayfinder:build]
status: open
assignee:
blockedBy: []
---

## Question

Found while fixing 132. The approval card is streamed while the run is still `running`; the run only becomes `awaiting_approval` after its pass ends (`packages/server/src/runs/executor.ts` ~610–640). `moveOnFromWaiting` in `runs/create-run.ts` only cancels `awaiting_approval` runs, so a message sent in that gap isn't treated as moving on. The new turn queues behind a run that then waits for approval indefinitely. A probe caught the run still `running` in 5/12 tries, and 4/12 ended stuck as `[queued, awaiting_approval]`. This is what makes `harness.spec` "a new message while a change waits skips the change" flaky (10/20 under load with 4 workers).

## Done when

- A new message sent while an approval card is pending, whether the run is `running` with a pending approval or `awaiting_approval`, moves on: it cancels or skips the pending change, as #63 decided.
- A deterministic server test for the gap, and the harness spec passes 20/20 under load.
