---
id: "016"
title: "WS-composer: the prompt composer"
labels: [wayfinder:build]
status: open
assignee: loop
blockedBy: ["008"]
---

## Question

A standalone, reusable composer: attachments, model/agent picker, context chip, `/` prompt
templates, and mentions (`PLAN.md` §6, D13).

## Owns

`packages/composer`.

## Done when

Component tests; usable in isolation with only `@workspace/ui` and the contract types.
