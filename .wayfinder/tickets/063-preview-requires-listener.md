---
id: "063"
title: "The agent's preview tool checks that something is listening"
labels: [wayfinder:build]
status: closed
assignee:
blockedBy: []
---

## Question

Connor (2026-09-29) saw "The preview isn't answering". The agent had built a TypeScript library with no server and
still called `preview`, so a dead preview was recorded and shown.

## Done when

- `preview` (in `packages/sandbox/src/tools/tools.ts`) probes the port inside the sandbox before exposing it: a quick
  `exec` check of whether anything listens on the port (e.g. `/proc/net/tcp{,6}` LISTEN on that port, so it doesn't
  depend on `ss`/`netstat` being in the image), retried briefly (about 5 s) so a server that is just starting counts.
- When nothing listens, the tool returns an error the model can act on ("Nothing is listening on port N. Start the
  dev server bound to 0.0.0.0 (e.g. `npm run dev -- --host 0.0.0.0 --port N &`) and call preview again."). It records
  nothing and exposes nothing.
- just-bash (no ports) is unchanged: `preview` stays unavailable there.
- The tool description tells the model to start servers in the background bound to 0.0.0.0 before previewing.
- Unit tests cover listening, not listening and slow start (fake exec). Gate passes.

## Owns

`packages/sandbox/src/tools/tools.ts` and `tools.test.ts`.

## Results

- `preview` now probes before exposing: `cat /proc/net/tcp /proc/net/tcp6 2>/dev/null` via the sandbox's `exec`,
  looking for state `0A` (LISTEN) on the port's hex. No `ss`/`netstat` needed. Up to 10 probes 500 ms apart (about 5 s),
  so a server that is still starting counts. The wait is an injectable `sleep` on `SandboxToolsOptions` (tests pass a
  no-op).
- Nothing listening: returns `{ status: "error" }` with "Nothing is listening on port N. Start the dev server in the
  background bound to 0.0.0.0 (e.g. `npm run dev -- --host 0.0.0.0 --port N &`) and call preview again." Nothing is
  exposed, so `onExposed`/`recordPreview` never runs.
- Also refused: a listener bound only to loopback (127.0.0.0/8, `::1`, `::ffff:127.x`). The runner's preview proxy dials
  the container IP (`runner.previewTarget`), so a server on localhost only is as dead as none, and Vite binds there by
  default. It fails at once with "only listens on localhost, which the preview can't reach" plus the same hint.
- If `/proc` has no socket tables (just-bash, the memory fake), the probe is inconclusive and the tool falls through to
  `exposePort` as before, so just-bash still says previews need a Docker workspace. The turn-tools preview test is
  unchanged.
- The description now says to start the server first, in the background and bound to 0.0.0.0, and not to preview a
  library or script that serves nothing.
- Tests (fake `exec`): listening, not listening (10 probes, 4.5 s of sleeps, nothing exposed, exact error text), slow
  start (listens on probe 3), IPv6-only listener, and loopback-only refused. The existing just-bash and memory preview
  test still passes.
- Gate: passes (82/82). An earlier run failed `@workspace/db#test` while load average was around 180; it passed alone
  and in the next two full runs.
- Not run against real Docker: the smoke test calls `exposePort` directly, not the tool.

## Resolution (2026-09-30, loop)

Merged in [PR #50](https://github.com/connorwforsyth/openchat/pull/50). `preview` checks /proc/net/tcp{,6} for a listener (~5 s of retries), refuses localhost-only servers, and tells the model how to start the server. Gate 82/82.
