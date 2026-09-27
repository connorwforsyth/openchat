---
id: "041"
title: "Server follow-ups: sandbox tools in turns, /api/llm, eval.run, migrations at boot"
labels: [wayfinder:build]
status: closed
assignee:
blockedBy: []
---

## Question

Left by 038:
1. **Sandbox tools in agent turns** — agents whose version names a sandbox provider (or chats with an
   attached sandbox) get 019's `bash`/`read`/`write`/`edit`/`preview` tools in the turn resolver;
   `write`/`edit` produce `ProposedEdit`s that pause the run for per-hunk review (`awaiting_approval`),
   and only accepted hunks apply on resume (`PLAN.md` §11 M1 steps 6 and 7).
2. **`/api/llm`** — mount 013's `handleLlmProxy` as `POST /api/llm` (auth, context keys, usage).
3. **`eval.run`** job handler for 022's evals (Agents+ uses it; register it now).
4. **Postgres migrations at boot** — run migrations on start when `DATABASE_URL` is set (advisory
   lock so replicas don't race), as PGlite already does.

## Owns

`packages/server` (turn resolver tools, routes, jobs, boot), `packages/sandbox` (only if a seam is
needed), tests.

## Done when

An in-process test: an agent with the just-bash sandbox runs `ls && echo hi > a.txt && cat a.txt`;
an `edit` proposes a patch, one hunk accepted and one rejected, only the accepted one applied;
`POST /api/llm` streams with a mock model; migrations run once across two concurrent boots.

## Resolution (2026-09-27, loop)

Merged in [PR #32](https://github.com/connorwforsyth/openchat/pull/32): sandbox tools in agent turns with per-hunk review on `write`/`edit` (M1 steps 6–7), `POST /api/llm` (auth, context keys, budget, usage), an `eval.run` job handler, Postgres migrations at boot under an advisory lock. Verified: in-process scenarios pass; tests 24/24 at concurrency 2; typecheck/lint/build 53/53; no schema drift.
