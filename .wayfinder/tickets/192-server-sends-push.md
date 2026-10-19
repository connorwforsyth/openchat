---
id: "192"
title: "The server sends a push when a run finishes or needs an approval"
labels: [wayfinder:build]
status: open
map: "179"
assignee:
blockedBy: ["191", "193"]
---

## Question

Implement 191's routes and a notification sender behind a small port (`Notifier`), an APNs adapter on `node:http2` (no dependency) and a `web-push` adapter, sent from a `notify.run` job, wired where [the closed-tab research](181-web-run-survives-closed-tab.md) found the hooks: `afterRun` (`services.ts`) queues a "done" job, and a new `onAwaitingApproval` in the executor's `settle` queues a "needs you" job. The rules for expiry, interrupted runs and recipients come from [193](193-approval-expiry-and-interrupted-runs.md). Degrades to off without keys; drops tokens on 410; never pushes for a run the user is actively watching (if that's knowable cheaply).

## Done when

- Handlers and the sender are tested in-process with fakes and MSW (no real APNs); a migration adds `push_device`; the APNs adapter is tested with a fake transport plus one local HTTP/2 server.
- With no APNs/VAPID keys the app boots and the routes report push unavailable.

## Owns

`packages/server/src/notifications/**`, `packages/db` (devices table + queries), the notifier port file, `.env.example` entries.
