---
id: "011"
title: "WS-db: schema, migrations and queries"
labels: [wayfinder:build]
status: closed
assignee:
blockedBy: ["008"]
---

## Question

Implement the M1 tables in `PLAN.md` §7 with Drizzle (the version decided in 003),
migrations, typed query modules, tsvector search columns and pgvector HNSW indexes,
and a PGlite test harness other packages can reuse.

## Owns

`packages/db`.

## Done when

`bun turbo db:migrate` works against the compose Postgres; query modules have PGlite
tests; CI runs them against Docker Postgres as well. Split if more than about a day.

## Resolution (2026-09-27, loop)

Built in [PR #8](https://github.com/connorwforsyth/openchat/pull/8): `packages/db` on Drizzle 1.0 RC with every M1 table from `PLAN.md` §7 (UUIDv7 ids including Better Auth's tables; `resource_grant` with a per-type permission CHECK; message tree with a same-conversation composite FK; pgvector `file_chunk` with per-dimension partial HNSW indexes; tsvector search), 50 tests over 11 query modules, `@workspace/db/testing` (`createTestDb` on PGlite or `TEST_DATABASE_URL`), `db:generate`/`db:migrate`, and a CI `db` job on Postgres 17.

Verified: 38/38 turbo tasks; the CI `db` job migrated twice and passed the db tests on real Postgres 17 (57 s). Added tables: `invitation_team`, `user_settings`, `mcp_oauth_token`. Visibility is derived on read. Left for later tickets: run-state mapping (014), usage summaries (024), eval queries (Agents+), artifact/sandbox queries (019/020). Questions 14–15 logged.
