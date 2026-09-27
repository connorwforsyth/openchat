---
id: "019"
title: "WS-sandbox: just-bash, sandbox-runner and panel"
labels: [wayfinder:build]
status: closed
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

## Resolution (2026-09-27, loop)

Merged in [PR #19](https://github.com/connorwforsyth/openchat/pull/19) together with 029: `packages/sandbox` (just-bash provider with persisted snapshots, docker provider over the runner's HMAC API, stubs for remote providers, provider registry, `bash`/`read`/`write`/`edit`/`preview` tools with per-hunk review via code-ui's `applyReview`, handlers for all 8 `sandbox` routes, an exec job handler); `apps/sandbox-runner` (Hono; container-spec builder with no host mounts, read-only root, dropped caps, no-new-privileges, limits, per-sandbox internal network, egress policy; runsc/runc detection; streaming exec; preview proxy on a separate origin; snapshots; idle reaping) behind `docker-socket-proxy` in a `sandbox` compose profile; the lazy sandbox panel in `packages/chat-ui/src/sandbox/`; `/dev/sandbox`. Verified: 63/63 local; CI ci, db and the new sandbox job (runc and runsc) passed.
