---
id: "157"
title: "After the server is upgraded, an open tab recovers from missing chunks instead of breaking"
labels: [wayfinder:build]
status: open
assignee:
blockedBy: []
---

## Question

From the T3 Code study (`.context/research/t3code/web.md`, recommendation 11). After a self-hosted upgrade, a tab opened before it asks for hashed chunks that no longer exist and the next navigation fails. T3 reloads once on `vite:preloadError`, guarded in sessionStorage so it can't loop (`t3:apps/web/src/lib/chunkReloadGuard.ts`).

## Done when

- Read `apps/web/node_modules/next/dist/docs` for how Next 16 surfaces a chunk load failure (and whether it already hard-navigates); implement only what's missing.
- On a chunk load failure, the page reloads once to the same URL; a second failure within a short window shows the error boundary instead (no loop). Unsent drafts are flushed first if 147 has landed.
- A test (unit for the guard; e2e if practical by serving a build and deleting a chunk).
- Gate passes.

## Owns

`apps/web/app/**` (an error boundary or a small client module), tests.
