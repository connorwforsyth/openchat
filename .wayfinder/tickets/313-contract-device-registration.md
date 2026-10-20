---
id: "313"
title: "Contract: register a device or browser for push, and choose what notifies"
labels: [wayfinder:build]
status: open
map: "300"
assignee:
blockedBy: ["305", "315"]
---

## Question

Its own PR (AGENTS.md "Contract changes"). Routes and schemas from [push research](305-push-from-self-hosted.md) (`/me/push-devices` CRUD + test-send, preferences in user settings, public config `push` + capabilities `push.apns`/`push.web`): register / unregister a device (APNs) or browser (web push), list my devices, per-user notification preferences (run finished, approval needed), the `capabilities` flag clients check, and a cross-chat "what needs me" query (runs awaiting my approval or finished since I last looked), which [the closed-tab research](303-web-run-survives-closed-tab.md) found missing. Who receives approval pushes and whether approvals expire come from [the approval-expiry decision](315-approval-expiry-and-interrupted-runs.md). Explain who needs it and what breaks. Connor merges it.

## Done when

The contract PR is merged by Connor.

## Owns

`packages/contract/**`.
