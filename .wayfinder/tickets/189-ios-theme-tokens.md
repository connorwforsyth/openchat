---
id: "189"
title: "iOS colours and radius are generated from the web theme"
labels: [wayfinder:build]
status: open
map: "179"
assignee:
blockedBy: ["188"]
---

## Question

One theme source (iOS map Notes). A script reads the semantic tokens in `packages/ui/src/styles/globals.css` (light and dark) and writes colour sets into the app's asset catalog plus a small Swift `Theme` (radius, spacing). Brand accent from `/api/config` at runtime.

## Done when

- `bun apps/ios/scripts/tokens.ts` regenerates the catalog; a test fails if the committed catalog is stale.
- Swift code uses `Color("background")`-style semantic names only; the `tokens` guard (or a Swift twin) rejects literal colours in `apps/ios`.

## Owns

`apps/ios/scripts/**`, `apps/ios/**/Theme*`, the asset catalog's colour sets, `scripts/ci/tokens*` (Swift rule).
