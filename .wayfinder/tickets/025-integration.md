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

Performance (D27): composer-first boot. Preload only the entry, React and the matched route; defer everything else until `composer:ready`; inline server-evaluated public config and hydrate the TanStack Query cache; apply the theme before paint; no third-party font or asset hosts. Record TTFB, `composer:ready` and first-token latency in the Playwright checks.

Speed (D28): persist the TanStack Query cache (sidebar, library, recent conversations) to IndexedDB, render from it on boot and revalidate in the background; clear it on sign-out; an org policy can disable persistence. Inline-restore sidebar width/collapsed state before paint. Optimistic rename/pin/archive.

## Owns

`apps/web` app code, `e2e/`, `docker-compose.yml` additions.

## Done when

Every `PLAN.md` §11 M1 step passes headlessly (Playwright) except where a human is needed;
`bun turbo test:e2e` is green in CI.
