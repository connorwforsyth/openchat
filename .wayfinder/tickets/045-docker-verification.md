---
id: "045"
title: "Verify the Docker image and compose stack"
labels: [wayfinder:task]
status: closed
assignee:
blockedBy: []
---

## Question

Nothing Docker-related has run yet (the daemon was off; Actions minutes are exhausted). With Docker
Desktop running: build `apps/web`'s image, `docker compose up -d` with Postgres, run
`e2e/compose-smoke.ts`, run the db tests against Postgres 17 (`TEST_DATABASE_URL`), and run the
sandbox runner smoke (`--profile sandbox`, runc on macOS). Fix whatever fails.

**HITL step (done 2026-09-27):** Connor approved starting Docker Desktop; the loop started it.

## Done when

All four pass locally, results recorded here.

## Resolution (2026-09-27, loop)

All four pass locally (Docker Desktop 29.3.1, runc only, 10 vCPU / 8 GB VM). Fixed one bug the
Postgres 17 run found (commit `610d38e`): `deleteStaleTestChats` bound a JS `Date` against a raw SQL
expression. drizzle's postgres-js driver passes the timestamptz value through untouched, so
postgres-js threw ("Received an instance of Date"). PGlite accepts it, which is why only Postgres
caught it. The cutoff is now ISO text cast to `::timestamptz`, the same as the list cursor.
Gate: `bun run check`, `check:guards`, `bun turbo typecheck lint test build` 79/79.

| Check | Result |
|---|---|
| `docker compose build web` | pass, 1738 s (`bun install` 978 s, turbo build 692 s); `openchat-web` **388 MB** |
| `cp .env.example .env && docker compose up -d --wait` | pass, web healthy 8 s after start |
| `E2E_BASE_URL=http://localhost:3000 bun e2e/support/compose-smoke.ts` | pass 7/7, 1 s: first sign-up is admin, chat stored, signed-in page and `/sign-in` render |
| `GET /api/health?ready=true` | 200, `database: up`, `jobs: up`; a second sign-up gets 403 (invite-only); 5 migrations applied; `data/.secrets.env` generated, mode 0600, uid 1000 |
| `TEST_DATABASE_URL=postgres://…@127.0.0.1:5432/app bunx vitest run` on PG 17.11 | pass: db 69/69 (11 s), server 175 + 3 skipped (41 s), auth 118 (33 s), importers 58, mcp 40, sandbox 47. The 3 skips are the PGlite-only `skipIf(TEST_DATABASE_URL)` suites. No `test_*` databases left behind |
| Playwright suite against the stack | not run: `playwright.config.ts` always starts its own `serve.ts` with the mock model (`reuseExistingServer: false`), and `E2E_BASE_URL` is read only by `compose-smoke.ts` |
| `docker compose --profile sandbox up -d --build --wait` + `EXPECT_RUNTIME=runc bun apps/sandbox-runner/test/e2e/smoke.ts` | pass, 4 to 7 s: runtime runc with the admin warning, exec, hardening (uid 1000, read-only rootfs, offline), files, preview and 404 on an unexposed port, snapshot and restore, destroy with nothing left. `sandbox-runner` image **251 MB** (build 1087 s) |
| `docker compose --profile sandbox down -v` | done; no containers, volumes or networks left |

The run was slow and flaky at first for environmental reasons, not because of the code. The host
(16 GB) was swapping around 10 GB, and the Docker VM was mostly compressed or swapped out. So the
first two web builds stalled: `@workspace/contract` typecheck took over 600 s in the VM against
2.9 s on the host, and `bun install` took about 16 min. The first db runs hit their 60 s hook
timeouts (`CREATE DATABASE` took 8 s), and the first sandbox smoke failed at destroy. That failure
was the proxy's 600 s 504 on `DELETE /containers/…`. It didn't reproduce: a force-remove of an
identically hardened container took 0.2 s, and the rerun passed. Once the VM recovered, every
suite passed with its default timeouts. Images are kept for reruns: `openchat-web` 388 MB,
`t-045-sandbox-runner` 251 MB, plus pulled `pgvector:pg17` 464 MB, `node:24-bookworm-slim` 249 MB
and the socket proxy 33 MB. Build cache is about 5 GB (`docker builder prune` reclaims it).

## Resolution (2026-09-27, loop)

Merged in [PR #36](https://github.com/connorwforsyth/openchat/pull/36). The web image, the compose stack on Postgres 17.11 and the sandbox runner (runc) all pass; results are above. One Postgres-only bug fixed (`deleteStaleTestChats` bound a JS `Date` in raw SQL). Local gate 79/79. Left: Playwright against the compose stack (its config always starts its own mock server), and gVisor, which needs a Linux host.
