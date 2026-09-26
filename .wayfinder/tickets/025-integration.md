---
id: "025"
title: "Integration: wire M1 into apps/web"
labels: [wayfinder:build]
status: open
assignee:
blockedBy: ["011","012","013","014","015","016","017","018","019","020","021","022","023","024"]
---

## Question

Wire every workstream into `apps/web`, write the Playwright smoke suite, and make
`docker compose up` → `bun turbo db:migrate` → `bun dev` work end to end.

## Owns

`apps/web` app code, `e2e/`, `docker-compose.yml` additions.

## Done when

Every `PLAN.md` §11 M1 step passes headlessly (Playwright) except where a human is needed;
`bun turbo test:e2e` is green in CI.
