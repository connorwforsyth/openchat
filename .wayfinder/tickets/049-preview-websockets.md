---
id: "049"
title: "Preview proxy passes WebSocket upgrades (dev-server hot reload)"
labels: [wayfinder:build]
status: open
assignee: loop
blockedBy: []
---

## Question

046 found the sandbox-runner's preview proxy doesn't pass WebSocket upgrades, so a dev server's hot
reload (Vite HMR) fails in the preview. This is independent of 047's decisions.

## Done when

- The preview proxy in `apps/sandbox-runner` passes WebSocket upgrades to the sandbox port, with the same
  host/port checks and hardening as HTTP previews (no reach into other sandboxes or the host).
- Tests cover the upgrade and a refused upgrade to an unexposed port.
- The sandbox smoke (`EXPECT_RUNTIME=runc`, compose `--profile sandbox`) passes, including a WebSocket echo
  through a preview URL.

## Owns

`apps/sandbox-runner/src/**` except the tmpfs options in `spec.ts` (047), `apps/sandbox-runner/scripts/**`.
