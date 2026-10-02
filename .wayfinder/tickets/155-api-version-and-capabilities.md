---
id: "155"
title: "Contract: public config says the API version and the server's capabilities"
labels: [wayfinder:build]
status: open
assignee:
blockedBy: []
---

## Question

From the T3 Code study (`.context/research/t3code/remote-mobile.md` §3.2, `server.md` §8.6). A self-hosted server and its clients upgrade separately: the desktop app (and later the Expo and Swift apps) will talk to servers on older or newer versions. T3 sends a protocol version and advertises optional capability flags (missing means unsupported), and blocks with "update the app" or "update the server" on a mismatch (`t3:packages/client-runtime/src/connection/compatibility.ts`, `t3:packages/contracts/src/environment.ts`). openchat's `publicConfigSchema` has `features` (product flags) but no API version or wire capabilities.

**Contract change: its own PR, awaiting Connor's approval; the loop never merges it.**

## Done when

- `publicConfigSchema` gains `apiVersion` (integer) and `capabilities` (a list of strings such as `runs.resume`, `artifacts.publish`), both additive and optional for old servers. `openapi.json` regenerated.
- The server fills them; a test pins the current values.
- The desktop shell (and `packages/client`) read them and show a localised "this server needs a newer app" / "this server is older than this app" message when the version is outside the range they support. Missing fields mean the oldest version.
- A rule in `packages/contract`'s README: bump `apiVersion` on a breaking wire change; add a capability for an additive one.
- Gate passes.

## Owns

`packages/contract/src/schemas/meta.ts` and `openapi.json` (contract commit), `packages/server/src/**` (filling them), `packages/client/src/**`, `apps/desktop/src/**` (the check), tests.
