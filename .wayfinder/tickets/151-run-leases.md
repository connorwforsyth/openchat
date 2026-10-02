---
id: "151"
title: "A process booting doesn't fail runs another process is still streaming"
labels: [wayfinder:build]
status: open
assignee:
blockedBy: []
---

## Question

From the T3 Code study (`.context/research/t3code/server.md`, recommendation 4). At boot, `recover()` marks every `running` run failed (`packages/server/src/runs/executor.ts`, called from `server.ts`). With one process that's right; with two (a rolling deploy, a second replica, `apps/worker` in the Collaboration wave) the booting one kills the other's live runs. T3 reconciles at startup per session and keeps a test per scenario (`t3:apps/server/src/serverRuntimeStartup.reconcile.test.ts`).

## Done when

- A run carries an executor id and a heartbeat, refreshed while it streams; boot recovery fails only runs whose heartbeat has expired (a few multiples of the interval), and a periodic sweep catches ones that expire later.
- A migration adds the columns (nullable; old rows recover as today). No `packages/contract` change.
- Tests: two executors on one PGlite: booting the second leaves the first's run streaming; a run whose executor died is failed after the lease expires.
- Gate and e2e pass. Docker smoke if Docker is up.

## Owns

`packages/server/src/runs/executor.ts` (recover and heartbeat), `packages/db/src/schema/runs*.ts`, `packages/db/src/queries/runs*.ts`, a new migration, tests.
