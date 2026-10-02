---
id: "154"
title: "Brief loading and reconnecting states don't flash"
labels: [wayfinder:build]
status: open
assignee:
blockedBy: []
---

## Question

From the T3 Code study (`.context/research/t3code/web.md`, recommendation 6). T3 shows a status only if it lasts past a threshold and then keeps it for a minimum time (`t3:packages/client-runtime/src/delayedStatus.ts`, 400 ms each), so quick refetches and reconnects don't flicker spinners.

## Done when

- A pure `delayedStatus` (show after N ms, hold at least M ms) in `@workspace/shared`, with a hook in `packages/client`; the durations come from `motionMs` or named constants with a comment.
- Used for the run-stream reconnecting state, revalidating persisted queries where a spinner shows, and the sidebar or palette loading rows that currently flash. List each place.
- Unit tests with fake timers; a browser test that a 100 ms load shows nothing.
- Gate passes.

## Owns

`packages/shared/src/delayed-status.ts` (new), `packages/client/src/**` (the hook), and the call sites listed in the PR within `packages/chat-ui/src/**` and `packages/palette/src/**`.
