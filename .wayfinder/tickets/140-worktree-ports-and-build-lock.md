---
id: "140"
title: "Each worktree gets its own ports, and only one production build runs per machine"
labels: [wayfinder:build]
status: closed
assignee:
blockedBy: []
---

## Question

From the T3 Code study (`.context/research/t3code/engineering.md` §1, §5). The loop runs up to three agents at once on one laptop, and the log records the cost: an e2e failure "from a shared default e2e port" (`E2E_PORT` defaults to 3100 in every worktree, `playwright.config.ts`, `e2e/support/serve.ts`), `next dev` on 3000 everywhere, and "next build OOM-killed under load". T3 derives a port offset from a hash of the worktree path (`t3:scripts/dev-runner.ts` `resolveOffset`) and prints the resolved ports; openchat already serialises Vitest browser mode across worktrees with `scripts/ci/browser-lock.ts`.

## Done when

- A small pure function (e.g. `scripts/dev-port.ts` `portFor(base, checkoutPath)`) maps a checkout to a stable offset: 0 for the main checkout, a hash of the path for a linked worktree; an explicit env var (`E2E_PORT`, `EVALS_PORT`, `PORT`) still wins. Unit-tested.
- Playwright and `e2e/support/serve.ts` default to it instead of 3100; the evals default (`packages/evals/src/cli.ts`, 3184) and `bun dev` for `apps/web` use it too. The resolved port is printed on one line so an agent reads it rather than assumes.
- `browser-lock.ts` takes a lock name (default unchanged), and `apps/web`'s `build` and the root e2e run take a `next-build` lock, so two worktrees never run `next build` at once. A test covers the named lock.
- The main checkout behaves exactly as today (3000, 3100, 3184).
- Gate and e2e pass.

## Owns

`scripts/dev-port.ts` (new) and its test, `scripts/ci/browser-lock.ts` and its test, `playwright.config.ts`, `e2e/support/serve.ts` (the port default only), `packages/evals/src/cli.ts` (the port default only), `apps/web/package.json` scripts, root `package.json` scripts.

## Resolution (2026-10-16, loop)

Merged in [PR #115](https://github.com/connorwforsyth/openchat/pull/115): per-worktree dev ports and machine-wide build lock. Verified: full local gate; server/db PGlite timeouts under load ~80 passed when rerun alone, files untouched by the PR. Nothing left on this ticket.
