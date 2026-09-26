---
id: "011"
title: "WS-db: schema, migrations and queries"
labels: [wayfinder:build]
status: open
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
