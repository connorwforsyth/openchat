---
id: "022"
title: "WS-memory-evals: memory, feedback, traces and dev evals"
labels: [wayfinder:build]
status: closed
assignee:
blockedBy: ["014"]
---

## Question

The memory file with versions, the `update_memory` tool and undo, thumbs feedback,
OpenTelemetry export (off by default), and the Evalite dev-eval suites (artifact prompt,
Decider routing, tool calling) (`PLAN.md` D20, D21).

## Owns

`packages/ai/src/memory/`, `packages/ai/evals/`, feedback routes.

## Done when

`PLAN.md` §11 M1 step 8 passes; `bun turbo eval` runs on fixtures in CI.

## Resolution (2026-09-27, loop)

Merged in [PR #17](https://github.com/connorwforsyth/openchat/pull/17): memory (pure patch apply, size cap, `update_memory` with versions and a `MemoryStore` port, propose mode via approval, tool result `{summary, versionId, previousVersionId}` for the chat UI's undo note; skipped in shared/public/multi-participant chats), `memory` and `feedback` handlers, OTLP telemetry via `@ai-sdk/otel` (off by default, no content on spans), three Evalite dev-eval suites on recorded fixtures with a CI step. Verified: 64/64 including `eval`; "remember I prefer pnpm" end to end; CI passed. Questions 27–28 logged.
