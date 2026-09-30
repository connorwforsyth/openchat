---
id: "089"
title: "A NUL byte in tool arguments or results fails the whole run"
labels: [wayfinder:build]
status: open
assignee:
blockedBy: []
---

## Question

Found by the deterministic evals in [084](084-evals-harness-deterministic.md) (PR stacked on #70), where it is recorded as an expected failure. When this is fixed, that case turns into an unexpected pass and must be flipped to a plain gate.

A NUL in tool arguments, or in a tool result (reading a file that contains a NUL byte), fails the run with `internal`, most likely where the parts are stored in Postgres text columns.

## Done when

- A NUL in arguments is refused as a tool error; a NUL in a result is escaped or replaced before storage, and the model is told the file is binary where that applies.
- The run continues in both cases. The 084 cases pass as plain gates. Gate and e2e pass. No `packages/contract` change without Connor.

## Owns

`packages/server/src/runs/**` (part storage), `packages/sandbox/src/tools/**`, the 084 eval cases.
