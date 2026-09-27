---
id: "038"
title: "Integration: server wiring"
labels: [wayfinder:build]
status: open
assignee: loop
blockedBy: []
---

## Question

Split from 025 (read its full wiring list). Make `createServerFromEnv` / `createApp` production-complete: mount every router (012 `authRouter` + Better Auth handler, 014 chat, 017 library + `loadSharedResource`, 018 mcp, 019 sandbox, 021 files/search, 022 memory/feedback, 024 settings/admin data needs, keys/usage); services: provider registry + key store over the db, Decider from config, embedder, `knowledge`/`retrieval` for the turn resolver (036), storage driver (local/S3) with signed URLs keyed from `BETTER_AUTH_SECRET`, file-serving route with `Content-Disposition: attachment` + `nosniff`; job registry with ingestion, re-index, eval, title, test-chat prune; error mapping (`KnowledgeError.UNAVAILABLE`, sandbox `unavailable` → 503/`FEATURE_DISABLED`); random invite tokens (Q16); oRPC request batching (031); plain model chats get `file_search` over attachments; recover runs left `running` after a crash at boot (014); **empty `DATABASE_URL` → file-backed PGlite in `./.data` with migrations applied at boot** (Q15) so `bun dev` works with zero setup.

## Owns

`packages/server`, `packages/auth` (invite tokens), `apps/web/app/api/**` (route mount), additive db queries.

## Done when

An in-process test boots the full app from an empty env on PGlite, signs up the first user, creates a chat, runs a turn with a mock model (streamed, resumed), uploads + searches a file, and uses a library agent; `bun dev` with no `.env` serves `/api/meta`.
