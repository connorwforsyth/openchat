---
id: "091"
title: "A mentioned file can close its own wrapper in the instructions"
labels: [wayfinder:build]
status: open
assignee:
blockedBy: ["079"]
---

## Question

Found by the deterministic evals in [084](084-evals-harness-deterministic.md) (PR stacked on #70), where it is recorded as an expected failure. When this is fixed, that case turns into an unexpected pass and must be flipped to a plain gate.

A mentioned file's content goes into the instructions unescaped, so a file containing `</workspace-file>` ends its wrapper early and the rest reads as instructions. This is a prompt-injection hardening gap, not a sandbox escape.

## Done when

- Mentioned content can't end or forge its wrapper (escape the delimiter, or use a per-turn random delimiter).
- The 079 prompt snapshot changes only in the cases that contain the delimiter; say so in the PR. The 084 case passes as a plain gate. Gate and e2e pass.

## Owns

`packages/ai/src/prompts/fragments/mentions.md`, `packages/server/src/runs/workspace-context.ts`, the 084 eval cases.
