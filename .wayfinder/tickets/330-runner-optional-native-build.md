---
id: "330"
title: "Bundle the runner when optional CPU detection is absent"
labels: [wayfinder:build]
status: open
assignee: codex
blockedBy: []
---

## Problem

CI fails while bundling dockerode through ssh2 when its optional cpu-features package is absent. The existing native-addon external pattern covers .node files, but Bun also resolves the missing package entry point.

## Owns

`apps/sandbox-runner/package.json` (build command only), this ticket, and its ownership register entry in `.wayfinder/map.md`.

## Decision

Keep cpu-features external so ssh2's guarded require uses its existing fallback. Keep dockerode and ssh2 bundled because the runner image has no node_modules (PLAN.md D7).

## Done when

The old command fails with cpu-features absent. The new command builds, and the standalone bundle starts under Node without node_modules and answers health checks.

## Verification

A dangling optional-package symlink reproduces CI's missing cpu-features error with the old command. Adding the external flag passes. The full runner bundles, and its standalone output starts under Node 22.19 without node_modules, recovers against a fake Docker API, and returns HTTP 200 from /healthz. The image's Node 24 runtime still needs CI verification.
