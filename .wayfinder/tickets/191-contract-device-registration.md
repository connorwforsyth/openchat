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

Its own PR (AGENTS.md "Contract changes"). Routes and schemas from [push research](183-push-from-self-hosted.md): register / unregister a device (APNs) or browser (web push), list my devices, per-user notification preferences (run finished, approval needed), and the `capabilities` flag clients check. Explain who needs it and what breaks. Connor merges it.

## Done when

The contract PR is merged by Connor.

## Owns

`packages/contract/**`.
