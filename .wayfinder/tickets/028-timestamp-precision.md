---
id: "028"
title: "Fix: millisecond timestamps for keyset cursors; CI timeouts"
labels: [wayfinder:build]
status: closed
assignee:
blockedBy: []
---

## Question

Keyset cursors encode `createdAt` via JavaScript `Date` (milliseconds), but Postgres stores
`timestamptz` with microseconds, so `(created_at, id) > (cursor)` repeats or skips rows on real
Postgres 17 (seen in CI: `listMessages pages oldest first`). Six queries use this pattern
(messages, runs, usage, decisions, files, conversations, grants, orgs). Also the importers'
large-batch test times out at Vitest's 5 s default on CI runners.

## Owns

`packages/db/src/schema/columns.ts`, a new migration, `packages/importers/vitest.config.ts`.

## Done when

Every `instant()` column is `timestamptz(3)` (with a migration), the CI `db` job passes, and the
importers suite has a CI-safe timeout.

## Resolution (2026-09-27, loop)

Merged in [PR #18](https://github.com/connorwforsyth/openchat/pull/18): every `instant()` column is `timestamptz(3)` (a migration alters all 94 columns), so keyset cursors that round-trip through `Date` no longer repeat or skip rows; PGlite-backed suites (db, importers, mcp) get a 30 s test timeout. Verified: 56/56 local; CI `ci` and `db` (Postgres 17) passed.
