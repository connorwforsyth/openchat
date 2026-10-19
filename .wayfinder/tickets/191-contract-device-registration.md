---
id: "191"
title: "Contract: register a device or browser for push, and choose what notifies"
labels: [wayfinder:build]
status: open
map: "179"
assignee:
blockedBy: ["183"]
---

## Question

Its own PR (AGENTS.md "Contract changes"). Routes and schemas from [push research](183-push-from-self-hosted.md) (`/me/push-devices` CRUD + test-send, preferences in user settings, public config `push` + capabilities `push.apns`/`push.web`): register / unregister a device (APNs) or browser (web push), list my devices, per-user notification preferences (run finished, approval needed), the `capabilities` flag clients check, and a cross-chat "what needs me" query (runs awaiting my approval or finished since I last looked), which [181](181-web-run-survives-closed-tab.md) found missing. Explain who needs it and what breaks. Connor merges it.

## Done when

The contract PR is merged by Connor.

## Owns

`packages/contract/**`.
