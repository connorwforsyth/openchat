---
id: "045"
title: "Verify the Docker image and compose stack"
labels: [wayfinder:task]
status: open
assignee:
blockedBy: []
---

## Question

Nothing Docker-related has run yet (the daemon was off; Actions minutes are exhausted). With Docker
Desktop running: build `apps/web`'s image, `docker compose up -d` with Postgres, run
`e2e/compose-smoke.ts`, run the db tests against Postgres 17 (`TEST_DATABASE_URL`), and run the
sandbox runner smoke (`--profile sandbox`, runc on macOS). Fix whatever fails.

**HITL step:** Connor starts Docker Desktop (the loop won't launch apps on his Mac unasked).

## Done when

All four pass locally, results recorded here.
