---
id: "023"
title: "WS-importers: history importers and fork"
labels: [wayfinder:build]
status: open
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
