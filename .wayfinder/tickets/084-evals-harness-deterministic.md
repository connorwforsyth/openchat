---
id: "084"
title: "S3a: a black-box eval harness over our own API, deterministic mode"
labels: [wayfinder:build]
status: open
assignee: loop
blockedBy: ["080"]
---

## Question

Part of [081](081-evals-v2.md) (S3 of `docs/proposals/2026-09-30-eve-assessment.md`, section "S3 · Evals v2" and "Eval plan (S3)").
The harness and its deterministic suites: no keys, no network, the mock model.

## Done when

- New `packages/evals`: boots the app through `e2e/support/serve.ts` (production build plus PGlite) and drives it over HTTP,
  with no browser. `t.send(message, {as})`, `t.approve/reject/stop/reload`, `t.files()`.
- Assertions with `.gate()` and `.soft()`: `calledTool(name, argsMatcher)`, `notCalledTool`, `check(includes|equals|matches)`.
  `judge(criteria)` exists in the API but is skipped (reported as skipped, not passed) when no judge is configured; the judge itself is 085.
- Output: JUnit plus a JSON report in `.evals/<ts>/` (gitignored). `--strict` fails the run on any gate failure.
- Deterministic suites from the plan's eval table, the **D** checks only: baseline, tool selection and arguments, grounding,
  multi-turn, prompt injection, tenant isolation, approvals/denial/cancel/reconnect, file boundaries. Routing stays in Evalite.
  A case whose expected behaviour doesn't exist yet (the symlink escape, floor rules from the permissions proposal) is marked
  as an expected failure with the reason, never silently dropped.
- `bun run evals` runs it; it finishes in under 5 minutes; it is a turbo task the local gate can run. Evalite stays for `packages/ai/evals`.
- Gate and e2e pass. No `packages/contract` change.

## Owns

`packages/evals/**` (new), `e2e/support/**` (shared server and mock, additive only), root `package.json` script, `turbo.json`, `.gitignore`.
