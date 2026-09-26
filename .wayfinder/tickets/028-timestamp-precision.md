---
id: "028"
title: "Fix: millisecond timestamps for keyset cursors; CI timeouts"
labels: [wayfinder:build]
status: open
assignee: loop
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
