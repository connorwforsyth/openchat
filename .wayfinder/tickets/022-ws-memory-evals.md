---
id: "022"
title: "WS-memory-evals: memory, feedback, traces and dev evals"
labels: [wayfinder:build]
status: open
assignee: loop
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
