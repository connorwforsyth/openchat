---
id: "023"
title: "WS-importers: history importers and fork"
labels: [wayfinder:build]
status: closed
assignee:
blockedBy: ["011"]
---

## Question

Importers for ChatGPT, Claude and LibreChat exports into the message tree, and "fork",
ported from LibreChat's `fork.js` (`PLAN.md` D1, §8 Branching).

## Owns

`packages/importers` (new) and its routes.

## Done when

Each importer has fixture-based tests producing a correct branch tree.

## Resolution (2026-09-27, loop)

Merged in [PR #13](https://github.com/connorwforsyth/openchat/pull/13): `packages/importers` for ChatGPT (full mapping tree), Claude (linear or `parent_message_uuid` tree; synthetic fixture) and LibreChat (nested and flat) exports, streamed per conversation; `persistImport` (one transaction per conversation); `forkConversation` (direct-path default, include-branches, target-level) ported from LibreChat. `NOTICE` added. Verified: 44/44 turbo tasks, 58 tests, also run against LibreChat's real `__data__` exports; CI passed. Questions 21–23 logged.
