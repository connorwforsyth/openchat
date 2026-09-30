---
id: "088"
title: "A write through a symlinked directory breaks the chat's workspace for good"
labels: [wayfinder:build]
status: open
assignee:
blockedBy: []
---

## Question

Found by the deterministic evals in [084](084-evals-harness-deterministic.md) (PR stacked on #70), where it is recorded as an expected failure. When this is fixed, that case turns into an unexpected pass and must be flipped to a plain gate.

A tool write through a symlinked directory inside `/work` fails the run with `internal` and shows the model a raw ENOENT; every later `bash` in that chat then fails too. `sandbox.writeFile` through such a directory returns 500, and `sandbox.exec` on that workspace returns 500 from then on. The workspace is unusable until it is recreated.

## Done when

- A write through a symlinked directory either lands inside `/work` or is refused with a tool error the model can read; the run continues.
- The workspace stays usable afterwards (bash, read, Files routes).
- The Files routes answer 4xx, never 5xx.
- The 084 eval cases pass as plain gates; a unit test in the sandbox package covers it. Gate and e2e pass.

## Owns

`packages/sandbox/src/**`, `apps/sandbox-runner/**` if the Docker provider is involved, the 084 eval cases.
