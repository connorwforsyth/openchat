---
id: "050"
title: "Build 047's choices: npm create in sandboxes, and non-blank dev previews"
labels: [wayfinder:build]
status: open
assignee: loop
blockedBy: ["047", "049"]
---

## Question

Implement what Connor picks in [047](047-sandbox-dev-previews.md).

## Done when

With compose `--profile sandbox` and the mock model, an agent runs `npm create vite` and a dev server,
and the preview renders in the chat's panel (PLAN.md §11 M1 step 6). The sandbox smoke covers it.

## Owns

`apps/sandbox-runner/**`, `packages/sandbox/**`, `packages/chat-ui/src/sandbox/**`.
