---
id: "003"
title: "Phase 0 risk checks"
labels: [wayfinder:research]
status: open
assignee:
blockedBy: ["002"]
---

## Question

Run the six checks in `PLAN.md` §12. Each could still change a decision:

1. Drizzle 1.0 RC works with Better Auth's Drizzle adapter and with PGlite (+ pgvector).
2. bun works with Expo autolinking and with electron-builder native modules (node-pty).
3. The AI Elements components we need migrate cleanly to Base UI.
4. Next.js 16 standalone on Node 24 works with the Hono mount and unbuffered SSE streaming.
5. Is gVisor (`runsc`) available on Docker Desktop for macOS and on a typical Linux VPS? Document the fallback.
6. Do React Native Reusables work on Expo SDK 57?

Also clone LibreChat read-only to `~/GitHub/_reference/LibreChat` (`--depth 1`) for later porting.

## Owns

`docs/decisions/`, `.context/research/`, throwaway spikes under `spikes/` (deleted or
left out of the PR once findings are written).

## Done when

- One decision record per check in `docs/decisions/NNNN-<slug>.md`: result, evidence, and what changes.
- Any check that fails is added to `QUESTIONS-FOR-CONNOR.md` with the fallback recommended in `PLAN.md` §12.
