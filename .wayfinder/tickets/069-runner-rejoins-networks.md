---
id: "069"
title: "The runner rejoins sandbox networks after it restarts"
labels: [wayfinder:build]
status: closed
assignee:
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

## Results (2026-09-30, loop)

The runner now puts itself back on sandbox networks after it restarts, both at startup and when a sandbox is next used.

- **Joining on use** (`apps/sandbox-runner/src/runner.ts`). A new `joinNetwork(id)` connects the runner's container
  to `networkName(id)`. Docker's "already connected" (403, tolerated by the dockerode adapter) counts as joined. Each
  process remembers what it has joined, so a preview request makes no Docker call once the runner is on the network.
  Concurrent callers share one attempt. A failed attempt isn't remembered, so the next call retries. `create`,
  `exposePort` and `previewTarget` all use it, and `destroy` forgets the sandbox.
  - `exposePort` returns `unavailable` ("the sandbox host couldn't reach the sandbox's network, so previews can't
    load") when Docker refuses, rather than handing out a URL that can't load.
  - `previewTarget` joins on a best-effort basis. If the join fails, the proxied request fails and returns a 502.
- **Startup reconciliation.** `recover()` rejoins the network of every running managed sandbox (labels
  `sandbox-runner.managed=true` plus `sandbox-runner.sandbox`), then logs `{count, rejoined}`. `main.ts` runs it
  before it starts serving. Stopped sandboxes rejoin when they're next used. Exposed ports aren't restored, because
  067 re-exposes them from the server.
- **Timeout** (`app.ts` `createPreviewApp`). The proxy aborts a request that hasn't started answering within 30 s
  (`answerTimeoutMs`) and returns 502 "The preview isn't answering". The timer covers only the wait for the response
  head, so a long body still streams. I chose 30 s rather than 10 s because a dev server may compile before it answers
  a first request. The unreachable-network case already fails sooner: Node's fetch has a 10 s connect timeout (see
  below).
- **In-memory Docker** (`docker-port.memory.ts`):
  - `connectNetwork` now fails for a missing network.
  - It records calls in `connects`.
  - `recreate(container)` drops a container from every network, like `--force-recreate`.

### Verification

- **Unit tests:** sandbox-runner 45/45, with 4 new tests in `app.test.ts` under "the runner after a restart". All 4 fail
  without the fix.
  - After a restart (a new runner over the same Docker state, with the runner container recreated), exposing the port
    again rejoins the network and the preview reaches the sandbox. Two concurrent exposes plus three requests make one
    connect.
  - `recover()` joins only running managed sandboxes: not a stopped one, and not a running container that has a
    sandbox label but isn't managed. It doesn't restore ports.
  - A refused join returns a clear `unavailable` and the next attempt succeeds.
  - A sandbox that never answers gets a 502.
- **Real Docker:** compose project `t069` on ports 7270/7271, with `container_name`, `RUNNER_CONTAINER` and a long
  `SANDBOX_IDLE_MINUTES` overridden. The image `t069-sandbox-runner` was built from host-built dist on
  `node:24-bookworm-slim`.
  - **Bug reproduced with the old image (`t050-sandbox-runner`).** I created a sandbox, exposed a port, and the preview
    returned 200. After `up --force-recreate`, the runner was no longer on `sbx-<id>`, and a re-exposed preview returned
    **502 after 10.6 s**. That 502 comes from undici's connect timeout, so every preview request stalled for about 10 s.
  - **With the new image, `--force-recreate`:** the startup log showed `rejoined` equal to `count`, the runner was back
    on `sbx-<id>` before any call, and the preview returned **200 in 28 ms**.
  - **Plain `restart`** (the runner was still attached): the 403 was tolerated and the log showed `rejoined` equal to
    `count`.
  - **Sandbox stopped, runner recreated:** the runner didn't join at startup (`count: 1`). The next `exposePort` started
    the sandbox and joined its network.
  - `bun run smoke` passed.
  - I ran `down -v` on `t069` and deleted the temporary check script. No `t069`/`sbx-*` containers, networks or volumes
    of mine are left.
- **Gate:** `gate.sh` passes (check, guards, `turbo typecheck lint test build` 82/82).

Notes:
- Startup reconciliation joins **every** running managed sandbox on the Docker host. The `t069` test runner therefore
  also joined Connor's live sandbox network (`sbx-01a0ef36-…`) until teardown. That network's members are back to just
  the sandbox and `sandbox-runner`. With one runner per host, which is the design, this is correct. It matters only
  when two runners share one Docker host.
- The membership cache is per process. If someone disconnects the runner by hand while it keeps running, previews
  fail (502) until the runner restarts.
- `openchat-sandbox-runner` (Connor's local image) hasn't been rebuilt. Rebuild it after merge, then
  `docker compose --profile sandbox up -d --force-recreate sandbox-runner`. That recreate is exactly the case this
  ticket fixes.

## Resolution (2026-09-30, loop)

Merged in [PR #58](https://github.com/connorwforsyth/openchat/pull/58). `joinNetwork` on use plus `recover()` at startup; the preview proxy times out at 30 s with a 502. Runner tests 45/45, real Docker checked, gate 82/82.
