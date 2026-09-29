---
id: "063"
title: "The agent's preview tool checks that something is listening"
labels: [wayfinder:build]
status: open
assignee: loop
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
