---
id: "076"
title: "next dev crashes when just-bash runs (SecurityViolationError)"
labels: [wayfinder:build]
status: closed
assignee:
blockedBy: []
---

## Question

070's agent found that `next dev` crashes when a just-bash sandbox runs, with a `SecurityViolationError`. Connor's
local dev server died mid-tool-call on 2026-09-29 (exit 7, stack in `executeToolCall`). That's probably the same
bug. A crash in one tool call must never take down the server.

## Done when

- **Reproduce** in `next dev` with a just-bash workspace (the e2e mock `[tool:bash …]` against `E2E_DEV=1`, see
  `e2e/README.md`). Find the root cause: likely just-bash's sandboxing clashing with Next dev/Turbopack's module or
  global patching, or an unhandled rejection or thrown error escaping the tool call.
- **Fix the cause.** Also make sure tool-call failures, and errors from sandbox providers in general, surface as tool
  errors on the run rather than as uncaught exceptions or unhandled rejections that crash the process. Add a
  process-level guard only if it's safe and logged; don't paper over real bugs.
- **Tests.** A regression test at the lowest practical level, plus an e2e check under `E2E_DEV=1` that a bash tool
  call completes and the server stays up.
- Gate passes; e2e passes (prod mode) and the dev-mode check passes.

## Owns

`packages/sandbox/src/just-bash/**`, `packages/sandbox/src/providers.ts`, `packages/server/src/runs/**` (error
handling only), `apps/web/next.config.ts` / `apps/web/instrumentation*.ts` if the cause is bundling, `e2e/**`
(dev-mode check), tests.

## Results (2026-09-30, loop)

Branch `t/076-just-bash-dev-crash`, not pushed; `status` stays `open`.

**Reproduced.** `E2E_DEV=1` over `workspace.spec.ts`: the first `[tool:bash …]` killed `next dev` (the run shows
"Stopped"). The stack goes through `executeToolCall` → our `bash` tool → `Bash.exec`, the same as Connor's crash on
2026-09-29.

**Root cause.** React's development build of the server renderer (`next/dist/compiled/next-server/app-page*.runtime.dev.js`,
which `next dev` loads and production doesn't) installs a process-wide `async_hooks` hook. That hook tracks async
debug info for every promise and timer: it reads `performance.now()`, makes a `WeakRef`, and sometimes captures a
stack by *setting* `Error.prepareStackTrace`. An async hook runs synchronously in the async context of whatever created
the resource. Inside a just-bash command, that context is the one just-bash's defense-in-depth layer guards, and the
layer has swapped exactly those globals for proxies that throw `SecurityViolationError`. Node treats a throw from an
async hook as fatal. Next's dev fatal-error handler then logs the error, and its source-mapping patch reads
`process.env.__NEXT_SHOW_IGNORE_LISTED`, which is also blocked, so the exception handler itself throws: **exit code
7**. The first trip is `performance_timing`. With that and `weak_ref` excluded, a `sleep` still trips
`error_prepare_stack_trace` (a Timeout created in the command), and just-bash doesn't let that one be excluded. So no
exclusion list works under `next dev`.

**Fix** (`packages/sandbox/src/just-bash/provider.ts`, `providers.ts`).
- `defenseInDepthFor(env)` turns the layer off when `NODE_ENV` is `development`, and nowhere else.
- `sandboxProvidersFromConfig` takes `env` (default `process.env`) and passes the answer to the just-bash factory. When
  the layer is off it logs one line at boot saying so.
- A throw from `bash.exec` is now the command's `unavailable` error Result (`runBash`), not a rejection. The AI SDK
  already turned a throwing tool into a tool error, and the run executor already catches everything it runs. The
  async-hook throw was the only path that escaped, and it can't be caught, only prevented.
- No process-level handler: nothing else escapes, and one wouldn't have helped, since Node removes
  `uncaughtException` listeners for async-hook errors.

**Security trade-off (for Connor).** Under `next dev` only, just-bash runs without its *secondary* defense-in-depth
layer. The layer blocks JS-level escape vectors (`Function`, `eval`, `process.*`, timers, `WeakRef`, `performance`, …)
in case the interpreter has a bug. The sandbox itself is unchanged: an in-memory filesystem, no processes, no network,
and JavaScript and Python off. Production (`next start`, standalone, Docker) and tests keep the full layer. The prod e2e
runs with it.

Options considered:
1. Exclude violation types. Not enough: `error_prepare_stack_trace` can't be excluded.
2. Audit mode in dev. It doesn't block either, and it records a stack for every hooked promise.
3. Wrap `async_hooks.createHook` from `instrumentation.ts` so hook callbacks run trusted. This monkeypatches Node
   globally and depends on load order.
4. **Run just-bash in a `worker_thread`** (its own realm, with no React hook), everywhere. This is the only option that
   keeps the layer under `next dev`, and it's stronger in production too: just-bash's README recommends an isolated
   worker for complete protection. It's a bigger change: an RPC for exec and the file operations, and a worker entry
   that Turbopack (dev and build), the standalone trace and Vitest can all load. That's a follow-up, if dev parity
   matters.

**Tests.**
- `just-bash/provider.test.ts` (new "under a host's async hooks"). `testing/host-async-hook.ts` is an async hook shaped
  like React's that records throws instead of dying. The tests cover these cases:
  - The default layer trips under the hook, which documents the mechanism and keeps the default on.
  - With the layer off, a timer, a pipe and a loop run with no throws.
  - `defenseInDepthFor` is off only for `development`.
  - An interpreter that throws (a conflicting defense config) comes back as `unavailable`.
  - Both the "layer off" test and the throw test fail without the fix.
- `providers.test.ts`: `NODE_ENV=development` gives a just-bash sandbox that runs under the hook without throws, and
  logs the notice. `production` doesn't log.
- e2e `workspace.spec.ts`: "a command with a timer, a pipe and a loop finishes, and the server keeps serving". It runs
  `sleep`, a pipe and a loop, checks `/api/config` answers, and makes a second tool call. It runs in prod e2e, and it's
  the dev-mode check under `E2E_DEV=1` (see `e2e/README.md`).

**Verification.**
- Gate (`gate.sh`): check clean, 82/82 turbo tasks. Sandbox unit tests: 132/132.
- `E2E_PORT=3573 bun turbo test:e2e`: 34 passed.
- Dev check: `E2E_DEV=1 E2E_PORT=3576 bunx playwright test e2e/tests/workspace.spec.ts` gives 12 passed, with the
  server up throughout (before the fix, it died on the first bash call).

## Resolution (2026-09-30, loop)

Merged on Connor's decision (2026-09-30): he accepted the dev-only relaxation of just-bash's defense-in-depth layer, with the worker-thread isolation as follow-up [083](083-just-bash-worker-thread.md). Verified on the rebased branch: gate 82/82, e2e 44/44. [PR #65](https://github.com/connorwforsyth/openchat/pull/65).
