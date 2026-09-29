---
id: "069"
title: "The runner rejoins sandbox networks after it restarts"
labels: [wayfinder:build]
status: open
assignee: loop
blockedBy: []
---

## Question

Connor's preview hung after the sandbox-runner container was recreated. The runner joins a sandbox's private network
(`networkName(id)`) only when it creates the sandbox (`runner.ts` ~280), so a recreated runner can't reach existing
sandboxes: preview requests time out. Separately, exposed ports live only in memory; 067 re-exposes recorded previews
from the server side.

## Done when

- `previewTarget` and `exposePort` make sure the runner container is connected to the sandbox's network before using
  it (idempotent; an "already connected" answer is fine; best effort with a clear error when Docker refuses).
- On startup the runner reconciles: for every running managed sandbox it rejoins its network. It doesn't restore
  exposed ports (067 does that).
- Tests with the in-memory Docker: after a "restart" (a new runner over the same Docker state), a preview of an exposed
  port reaches the sandbox; startup reconciliation connects to running sandboxes' networks only.
- Gate passes; the runner smoke passes; the local runner image is rebuilt.

## Owns

`apps/sandbox-runner/src/**` (runner.ts, main.ts, docker-port*.ts if needed, tests).
