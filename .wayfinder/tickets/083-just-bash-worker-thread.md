---
id: "083"
title: "Run just-bash in a worker thread"
labels: [wayfinder:build]
status: open
assignee:
blockedBy: []
---

## Question

[076](076-just-bash-dev-crash.md) (PR #65) stopped `next dev` crashing when just-bash runs by turning off just-bash's
defense-in-depth layer when `NODE_ENV=development` (`defenseInDepthFor(env)` in `packages/sandbox/src/just-bash/provider.ts`).
Connor accepted that on 2026-09-30 as a stopgap. The layer patches process-wide globals, which is what collides with
Next's dev server. Running the interpreter in a worker thread keeps the layer on everywhere, because the patches land in
the worker's realm and not the host's.

## Done when

- just-bash runs in a `worker_threads` worker (one per sandbox, or a small pool) with defense-in-depth **on** in every
  `NODE_ENV`; `defenseInDepthFor` and its dev exception are removed.
- The `SandboxProvider` port is unchanged: exec, streaming output, abort (Stop kills the command and keeps partial
  output, as 072 requires), file read/write, and the `/work` filesystem all behave as today.
- `next dev` survives the 076 e2e check ("a bash command can't take next dev down") with the layer on.
- A worker that crashes or hangs is replaced, and the run gets a tool error, not a dead server.
- Works in the production build and in the desktop sidecar (no runtime filesystem path assumptions for the worker entry).
- Gate and e2e pass.

## Owns

`packages/sandbox/src/just-bash/**`, `packages/sandbox/src/providers.ts` (the dev exception only), `e2e/tests/workspace.spec.ts` (the 076 check).
