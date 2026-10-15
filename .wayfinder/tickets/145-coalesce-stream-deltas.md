---
id: "145"
title: "Adjacent text and reasoning deltas are merged before they're stored as run chunks"
labels: [wayfinder:build]
status: closed
assignee:
blockedBy: []
---

## Question

From the T3 Code study (`.context/research/t3code/server.md`, recommendation 2). The Postgres stream channel writes one `run_chunk` row per `UIMessageChunk`, so a long answer is thousands of rows and a resume from cursor 0 replays every token. T3 coalesces before it persists (`t3:apps/server/src/orchestration/ThreadLiveEventCoalescer.ts`, paragraph buffering in `ProviderRuntimeIngestion.ts`). openchat's `writeBatch` (`packages/server/src/stream/postgres-stream-channel.ts`) already groups the appends made while the previous batch was writing; merging inside that batch is free.

## Done when

- A pure function merges consecutive `text-delta` chunks with the same `id` (and `reasoning-delta` likewise) within a batch; every other chunk type, and the order, are untouched. Unit-tested, including interleaved ids and non-delta chunks between deltas.
- `writeBatch` stores the merged list. Each append still resolves `ok(seq)` with the seq of the row that now holds its text (several appends may share one), and the `StreamChannel` port's documented behaviour holds (the port file is not edited; if its doc promises one row per append, stop and report).
- No change to what a client renders: the existing stream-channel and harness tests pass, plus a test that a resumed stream reproduces the same final text.
- Report the row count before and after for a long mock answer in the PR.
- Gate and e2e pass.

## Owns

`packages/server/src/stream/postgres-stream-channel.ts`, a new pure module beside it, their tests.

## Resolution (2026-10-16, loop)

Merged in [PR #117](https://github.com/connorwforsyth/openchat/pull/117): adjacent text/reasoning deltas coalesced before storing run chunks. Verified: full local gate. Nothing left on this ticket.
