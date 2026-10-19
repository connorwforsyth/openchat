---
id: "192"
title: "The server sends a push when a run finishes or needs an approval"
labels: [wayfinder:build]
status: open
map: "179"
assignee:
blockedBy: ["181", "191"]
---

## Question

Implement 191's routes and a notification sender behind a small port (`Notifier`), APNs and web push adapters, wired where [the closed-tab research](181-web-run-survives-closed-tab.md) found the hook. Degrades to off without keys; drops tokens on 410; never pushes for a run the user is actively watching (if that's knowable cheaply).

## Done when

- Handlers and the sender are tested in-process with fakes and MSW (no real APNs); a migration adds the devices table.
- With no APNs/VAPID keys the app boots and the routes report push unavailable.

## Owns

`packages/server/src/notifications/**`, `packages/db` (devices table + queries), the notifier port file, `.env.example` entries.
