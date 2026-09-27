---
id: "043"
title: "Browser-mode tests survive parallel turbo runs"
labels: [wayfinder:build]
status: closed
assignee:
blockedBy: []
---

## Question

When turbo runs several Vitest browser-mode packages at once (chat-ui, composer, library-ui,
palette, apps/web …), headless Chromium sometimes fails to connect ("Failed to connect to the browser
session") or tests time out, on a loaded dev machine and on CI runners. Each package passes alone.
Fix it structurally: raise Vitest's browser `connectTimeout`, cap browser instances per package
(`maxWorkers`/`fileParallelism` for browser projects), and/or make turbo's `test` task for browser
packages serialise (e.g. a `test:browser` task with `concurrency` or a turbo `with`/dependsOn chain).

## Owns

`packages/*/vitest.config.ts`, `apps/*/vitest.config.ts`, `turbo.json`, root scripts.

## Done when

`bun turbo typecheck lint test build --force` (default concurrency) passes 3 times in a row on this
machine while another heavy process runs; the local merge gate goes back to default concurrency.

## Resolution (2026-09-27, loop)

Merged in [PR #33](https://github.com/connorwforsyth/openchat/pull/33): a machine-wide lock (`scripts/ci/browser-lock.ts`) serialises browser-mode test runs across packages and worktrees; browser configs get `connectTimeout: 600_000`, `maxWorkers: 2` and an in-process network service; the guard enforces it. 3 consecutive default-concurrency runs under load: 77/77 each. The local gate is back to default concurrency.
