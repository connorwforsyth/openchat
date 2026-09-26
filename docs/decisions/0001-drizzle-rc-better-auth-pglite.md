# 0001: Drizzle 1.0 RC with Better Auth and PGlite (+ pgvector)

- Status: accepted
- Date: 2026-09-26
- Ticket: [003](../../.wayfinder/tickets/003-risk-checks.md), `PLAN.md` §12 check 1
- Result: **PASS**

## Context

`PLAN.md` §5 and Q7 pin `drizzle-orm` to the 1.0 release candidate. Better Auth's Drizzle
adapter and PGlite (our test database, D9) both have to work with it, and RAG needs pgvector
in PGlite as well as in the `pgvector/pgvector:pg17` compose service. The §12 fallback is
drizzle-orm 0.45 stable with a planned upgrade.

## Check performed

A throwaway bun project outside the repo:

1. Better Auth with the Drizzle adapter over `drizzle-orm/pglite`, email and password on.
2. `auth generate` (Better Auth CLI) to emit the Drizzle schema, plus an app table with a
   `vector(3)` column and an HNSW cosine index.
3. `drizzle-kit generate` (one custom migration for `CREATE EXTENSION vector`, one generated),
   applied with `drizzle-orm/pglite/migrator`.
4. `auth.api.signUpEmail`, `signInEmail`, `getSession`, a relational query (RQB v2) through the
   generated relations, and a `cosineDistance` nearest-neighbour query.
5. `tsc --noEmit` over the spike.

Versions (npm, 2026-09-26): `drizzle-orm@1.0.0-rc.4` and `drizzle-kit@1.0.0-rc.4` (the `rc`
dist-tag; `latest` is still 0.45.3), `better-auth@1.7.6`, `@better-auth/drizzle-adapter@1.7.6`,
`auth@1.7.6` (CLI), `@electric-sql/pglite@0.5.8`, `@electric-sql/pglite-pgvector@0.0.9`,
bun 1.4.0.

## Evidence

The adapter declares the RC as supported:

```text
$ npm view @better-auth/drizzle-adapter@1.7.6 peerDependencies
{ 'drizzle-orm': '^0.45.2 || >=1.0.0-rc.1 <2.0.0', ... }
```

**Gotcha 1: the default adapter entry generates a 0.45-style schema.** With
`import { drizzleAdapter } from "@better-auth/drizzle-adapter"`, `auth generate` writes
`import { relations } from "drizzle-orm"`, which 1.0 no longer exports:

```text
SyntaxError: Export named 'relations' not found in module '.../drizzle-orm/index.js'.
```

The package has a second entry, `@better-auth/drizzle-adapter/relations-v2`. With it the CLI
emits 1.0 relations:

```ts
import { defineRelationsPart } from "drizzle-orm";
export const authRelations = defineRelationsPart({ user, session, account, verification }, (r) => ({ ... }));
```

At runtime both entries worked against the RC; only the generated schema differs.

**Gotcha 2: `drizzle({ schema })` is gone in 1.0.** Passing `schema` fails typechecking;
pass `relations` only (`drizzle({ client, relations: authRelations })`). After that,
`tsc --noEmit` is clean.

**Gotcha 3: pgvector is no longer bundled in PGlite 0.5.** It moved to
`@electric-sql/pglite-pgvector` (`import { vector } from "@electric-sql/pglite-pgvector"`).

Run output (`bun run src/run.ts`):

```text
migrated; pg: PostgreSQL 18.3 (PGlite 0.5.8) on wasm32-unknown-emscripten
vector ext: [ { extversion: "0.8.1" } ]
signUp user: spike@example.test token? true
getSession user: spike@example.test session id? true
rqb v2: sessions 2 accounts 1
nearest: [ { content: "cats", distance: 0.00125 }, { content: "dogs", distance: 0.00184 } ]
users: 1
```

The generated migration used `vector(3)` and
`CREATE INDEX ... USING hnsw ("embedding" vector_cosine_ops)` as expected.

## Consequence for the plan

- Keep **`drizzle-orm@1.0.0-rc.4` and `drizzle-kit@1.0.0-rc.4`, exact pins**. The 0.45 fallback
  is not needed.
- `packages/db` must:
  - import the adapter from `@better-auth/drizzle-adapter/relations-v2`;
  - build the client with `relations` (merge Better Auth's `authRelations` part with ours via
    `defineRelations`/`defineRelationsPart`), never `schema`;
  - keep `CREATE EXTENSION IF NOT EXISTS vector` as the first (custom) migration;
  - load `@electric-sql/pglite-pgvector` in test setup.
- PGlite 0.5.8 runs **Postgres 18.3** while compose and production run 17. Tests stay on
  PGlite. Anything that depends on a Postgres major version needs a Postgres 17 integration
  test in CI (the compose service).
