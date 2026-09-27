---
id: "035"
title: "CI: 30 s test timeout in every package"
labels: [wayfinder:build]
status: closed
assignee:
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

## Resolution (2026-09-27, loop)

Merged in [PR #25](https://github.com/connorwforsyth/openchat/pull/25): every Vitest config sets `testTimeout: 30_000` and `hookTimeout: 60_000` (guarded by `scripts/ci/vitest-timeouts.test.ts`); packages using Testing Library get a 5 s `asyncUtilTimeout`; CI retries `bun install` once (better-sqlite3 build race) and `docker compose up` up to three times (Docker Hub pull flakes). CI passed on all four jobs.
