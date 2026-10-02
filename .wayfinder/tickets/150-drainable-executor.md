---
id: "150"
title: "Run tests wait on the executor going idle, not on sleeps"
labels: [wayfinder:build]
status: open
assignee:
blockedBy: []
---

## Question

From the T3 Code study (`.context/research/t3code/server.md`, recommendation 5). T3 tests wait on receipts (`t3:packages/shared/src/DrainableWorker.ts` `drain()`, a test-only receipt bus) and its AGENTS.md says "a test that needs a timeout to pass is wrong". openchat's run tests poll with `vi.waitFor` and short `setTimeout`s (e.g. `packages/server/src/runs/harness-reliability.test.ts`), which is where load-sensitive flakes come from (115, 132, 136). The executor already tracks its running runs (`executor.ts`).

## Done when

- `InProcessExecutor` exposes `idle(): Promise<void>` (resolves when no run is in flight and none is queued), and the in-memory job queue exposes `drain()`. Both documented and unit-tested.
- Run tests that sleep or poll for a run to settle use them instead; list the files changed. No `.skip`.
- The changed suites pass 20/20 repeated under load (`stress`-style loop), reported in the PR.
- Gate passes. The executor's port interface is unchanged (these are on the in-process adapter).

## Owns

`packages/server/src/runs/executor.ts` (the `idle` method only), `packages/server/src/jobs/memory*.ts`, run and job tests.
