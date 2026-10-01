---
id: "090"
title: "Tool arguments that don't fit the schema fail the run instead of returning a tool error"
labels: [wayfinder:build]
status: closed
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

## Resolution (2026-10-02, loop)

The same bug as [131](131-tool-error-fails-run.md), fixed there on `t/131-tool-errors`: the SDK already answered the call with a tool error, but `runAgent`'s `onError` failed the run on it, and `fromUIMessage` stored the refused call's `input` as `undefined` (the SDK keeps it in `rawInput`), which is the "couldn't store the answer's parts". The 084 case `tools`: "arguments that don't fit the tool's schema…" is a plain gate now and passes; see 131's Results.
