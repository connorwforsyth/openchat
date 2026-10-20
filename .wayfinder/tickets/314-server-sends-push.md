---
id: "314"
title: "The server sends a push when a run finishes or needs an approval"
labels: [wayfinder:build]
status: open
map: "300"
assignee:
blockedBy: ["313", "315"]
---

## Question

Implement [the push contract](313-contract-device-registration.md)'s routes and a notification sender behind a small port (`Notifier`), an APNs adapter on `node:http2` (no dependency) and a `web-push` adapter, sent from a `notify.run` job, wired where [the closed-tab research](303-web-run-survives-closed-tab.md) found the hooks: `afterRun` (`services.ts`) queues a "done" job, and a new `onAwaitingApproval` in the executor's `settle` queues a "needs you" job. The rules for expiry, interrupted runs and recipients come from [the approval-expiry decision](315-approval-expiry-and-interrupted-runs.md). Degrades to off without keys; drops dead tokens as the push research says. Suppressing a push while you're watching is the client's job in v1, not the server's.

## Done when

- Handlers and the sender are tested in-process with fakes and MSW (no real APNs); a migration adds `push_device`; the APNs adapter is tested with a fake transport plus one local HTTP/2 server.
- With no APNs/VAPID keys the app boots and the routes report push unavailable.

## Owns

`packages/server/src/notifications/**`, `packages/db` (devices table + queries), the notifier port file, `.env.example` entries.
