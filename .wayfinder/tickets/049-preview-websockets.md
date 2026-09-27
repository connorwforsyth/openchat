---
id: "049"
title: "Preview proxy passes WebSocket upgrades (dev-server hot reload)"
labels: [wayfinder:build]
status: closed
assignee:
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

## Results (2026-09-28, loop)

The preview proxy now passes WebSocket upgrades. Node gives upgrade requests to the server's
`upgrade` event, never to Hono, so `apps/sandbox-runner/src/preview-upgrade.ts` is a small
node:http listener that `main.ts` attaches to the preview server. It routes exactly like HTTP
previews: the Host header must parse as `{id}-{port}.` with a valid sandbox id, and the only
address ever dialled is `runner.previewTarget`'s (a port the sandbox exposed, on the sandbox's own
network). Anything else is refused before a connection opens: 404 for an unknown host, another
sandbox or an unexposed port, 400 for a non-WebSocket upgrade or a non-origin-form path. Headers
follow the HTTP proxy's rules (hop-by-hop and `proxy-authorization` dropped, `Host` becomes the
sandbox address). A dev server's refusal (say Vite's 400/403) is passed on; no answer within 10 s,
or nothing listening, is a 502. After the 101 the bytes are piped both ways and either side closing
closes the other. Hardening, tmpfs options, CORS and iframe attributes are untouched.

| Check | Result |
|---|---|
| `src/preview-upgrade.test.ts` (real runner on the in-memory Docker; only the returned address is moved to loopback) | 5 pass: upgrade to an exposed port echoes both ways with path/query kept, `Host` rewritten, proxy credentials dropped; unexposed port 404 and the upstream never contacted; other sandbox / non-preview host / raw sandbox IP 404 and `h2c` 400; dev server's 403 passed on; 502 when nothing listens |
| sandbox-runner suite | 36/36 |
| `docker compose -p t049 --profile sandbox up -d --wait sandbox-runner` + `EXPECT_RUNTIME=runc bun apps/sandbox-runner/test/e2e/smoke.ts` | pass. The smoke's in-sandbox server now also speaks a minimal WebSocket echo; Bun's `WebSocket` (with the preview `Host`) echoes a message through the preview URL, and a WebSocket to an unexposed port is refused |
| `docker compose -p t049 --profile sandbox down -v` | done; no sandbox containers, volumes or networks left. Image `t049-sandbox-runner` kept for reruns |

Notes:
- **Owns said `apps/sandbox-runner/scripts/**`**, which doesn't exist; the smoke lives in
  `apps/sandbox-runner/test/e2e/smoke.ts` (the package's `smoke` script), so that's what changed.
- An open WebSocket doesn't count as sandbox activity: `previewTarget` touches the idle clock once
  per handshake, like once per HTTP request. A sandbox left with only an HMR socket open is still
  stopped after `SANDBOX_IDLE_MINUTES`, which closes the socket, the same as an HTTP preview nobody
  requests. Worth revisiting if HMR sessions get reaped in practice.
- Vite HMR still needs 047/050's CORS decision before a dev preview renders in the panel's iframe;
  this ticket only removes the WebSocket gap.

## Resolution (2026-09-28, loop)

Merged in [PR #38](https://github.com/connorwforsyth/openchat/pull/38). WebSocket upgrades pass through the preview proxy with the HTTP preview checks; unit tests 36/36; Docker smoke on runc with a WebSocket echo; gate 79/79. Note: an open WebSocket doesn't keep a sandbox from idling out.
