---
id: "003"
title: "Phase 0 risk checks"
labels: [wayfinder:research]
status: closed
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

## Resolution (2026-09-26, loop)

Six decision records in [`docs/decisions/`](../../docs/decisions/README.md), merged in [PR #4](https://github.com/connorwforsyth/openchat/pull/4):
1. Drizzle 1.0 RC + Better Auth 1.7.6 + PGlite: **PASS**. Use `@better-auth/drizzle-adapter/relations-v2`, pass `relations` to `drizzle()`, pgvector via `@electric-sql/pglite-pgvector`. Keep the RC pin.
2. bun + Expo 57 autolinking / electron-builder + node-pty: **PASS** with caveats (isolated linker works; `expo-doctor` duplicate warnings).
3. AI Elements to Base UI: **PASS** (about half a day; issues listed for 007).
4. Next 16 standalone + Hono SSE on Node 24: **PASS**, unbuffered.
5. gVisor: **PARTIAL**. Linux 5.6+ only; not on Docker Desktop for macOS. Fallback runc + hardening + admin warning (D7). Logged as question 7.
6. RN Reusables on Expo 57 + Uniwind: **PASS** (native).

LibreChat is cloned read-only at `~/GitHub/_reference/LibreChat`. Not verified: native iOS/Android builds, gVisor on a real host, reverse-proxy buffering.
