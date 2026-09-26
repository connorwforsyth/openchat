---
id: "019"
title: "WS-sandbox: just-bash, sandbox-runner and panel"
labels: [wayfinder:build]
status: open
assignee:
blockedBy: ["013"]
---

## Question

The `Sandbox` interface implementations: the just-bash provider, `apps/sandbox-runner`
(dockerode behind a socket proxy, gVisor where available, limits, egress policy,
authenticated internal API), the AI SDK tools, and the sandbox side panel (`PLAN.md` D7, D24).

## Owns

`packages/sandbox`, `apps/sandbox-runner`, the sandbox panel in `packages/chat-ui/src/sandbox/`.

## Done when

`PLAN.md` §11 M1 step 6 passes (just-bash and Docker); `web` never mounts the Docker socket.
