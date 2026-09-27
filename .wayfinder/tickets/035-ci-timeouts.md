---
id: "035"
title: "CI: 30 s test timeout in every package"
labels: [wayfinder:build]
status: open
assignee: loop
blockedBy: []
---

## Question

Tests keep timing out at Vitest's 5 s default on loaded CI runners (auth, importers, palette,
library-ui, sandbox-runner so far), each one fixed package by package. Set `testTimeout: 30_000`
(and `hookTimeout: 60_000`) in every package's `vitest.config.ts` once, and add a repo guard that
fails if a new package config lacks them.

## Owns

`apps/*/vitest.config.ts`, `packages/*/vitest.config.ts`, `scripts/ci/` (guard).

## Done when

Every config has both timeouts; the guard catches a config without them; CI green.
