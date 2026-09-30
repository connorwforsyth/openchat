---
id: "090"
title: "Tool arguments that don't fit the schema fail the run instead of returning a tool error"
labels: [wayfinder:build]
status: open
assignee:
blockedBy: []
---

## Question

Found by the deterministic evals in [084](084-evals-harness-deterministic.md) (PR stacked on #70), where it is recorded as an expected failure. When this is fixed, that case turns into an unexpected pass and must be flipped to a plain gate.

When the model sends arguments that don't fit a tool's schema, the run fails with "couldn't store the answer's parts". The AI SDK reports these as invalid tool calls; the model should get an error it can correct.

## Done when

- Invalid arguments come back to the model as a tool error and the loop continues; the stored call shows the error.
- The 084 case passes as a plain gate. Gate and e2e pass.

## Owns

`packages/server/src/runs/**`, `packages/ai/src/agent/**`, the 084 eval cases.
