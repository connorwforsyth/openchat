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

Wiring collected from earlier tickets (don't lose these):
- Mount every router: 012 `authRouter`, 014 chat router, 017 `createLibraryRouter` + `loadSharedResource`, 018 mcp handlers, 019 sandbox handlers, 021 files/search + knowledge jobs, 022 memory/feedback, 024 settings/admin pages; correct 024's `_shared/routes.ts`.
- `services.ts`: pass `knowledge` (embedder) and `retrieval` (Decider + `decider.thresholds.needsRetrieval`) to the turn resolver (036); build the Decider from config (013); register ingestion/re-index/eval/test-chat-prune jobs.
- Plain model chats (no agent) get `file_search` over conversation attachments.
- `ARTIFACTS_ORIGIN` → chat-ui `runtimeOrigin` (030); attachments upload in `ConnectedChat` (015).
- Map `KnowledgeError.UNAVAILABLE` and sandbox `unavailable` to 503 / `FEATURE_DISABLED` (021, 019); file-serving headers `Content-Disposition: attachment` + `nosniff` (021); local storage URL secret derived from `BETTER_AUTH_SECRET` (021).
- Gate `/dev/*` behind an env flag (007); viewport `interactive-widget=resizes-content` (031); oRPC request batching for feedback (031); `requestLocale` reads `user.locale` (024); PGlite fallback when `DATABASE_URL` is empty (011, Q15); random invite tokens (012, Q16).

## Owns

`apps/web` app code, `e2e/`, `docker-compose.yml` additions.

## Done when

Every `PLAN.md` §11 M1 step passes headlessly (Playwright) except where a human is needed;
`bun turbo test:e2e` is green in CI.
