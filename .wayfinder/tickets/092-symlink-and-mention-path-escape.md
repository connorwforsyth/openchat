---
id: "092"
title: "Symlinks and @file paths can still read outside /work"
labels: [wayfinder:build]
status: open
assignee:
blockedBy: []
---

## Question

Known since [074](074-tool-paths-in-workspace.md) (PR #60), and now pinned as expected failures by [084](084-evals-harness-deterministic.md): `read`, `@file` and the Files route follow a symlink out of `/work`, and `@file` accepts absolute paths outside `/work` because it uses the loose path resolver.

## Done when

- `read`, `@file` and the Files routes resolve the real path and refuse anything outside `/work`, with a tool error or 4xx.
- `@file` uses the same resolver as the tools (`packages/sandbox/src/paths.ts`).
- The 084 cases pass as plain gates; the 074 tests still pass. Gate and e2e pass.

## Owns

`packages/sandbox/src/**`, `packages/server/src/runs/workspace-context.ts`, the Files routes, the 084 eval cases.
