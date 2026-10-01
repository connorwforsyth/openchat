---
id: "084"
title: "S3a: a black-box eval harness over our own API, deterministic mode"
labels: [wayfinder:build]
status: closed
assignee:
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

## Results (2026-10-01, loop)

Built on `t/084-evals-harness`, stacked on 080 ← 078 ← 079, unpushed.

- **`packages/evals`**: boots `e2e/support/serve.ts` on port 3184 (`EVALS_PORT`), makes ada (admin, owner of Acme
  and Globex), ben (Acme) and dee (Globex) over HTTP, and drives the API with the typed client, with no browser.
  `t.send/approve/reject/stop/reload/regenerate/settled/files/readFile/streamOf`, plus `t.api(as)` and `t.statusOf`.
  Assertions `calledTool`, `notCalledTool`, `check(…).includes/equals/matches` (and `.not`), `judge`, each counted with
  `.gate()` or `.soft()`; an uncounted assertion or a case that asserts nothing is an error. `.gate({ expectedFailure })`
  marks a known gap: it shows as XFAIL while failing and as an unexpected pass (failing `--strict`) once it passes.
  `judge()` reports skipped without a judge; `src/judge.ts` is the seam for 085.
- Reports: `.evals/<ts>/report.json` (zod schema in `src/report.ts`), `junit.xml`, `server.log`. `.evals/` is gitignored.
- `bun run evals` → `turbo run evals --` (own task, `dependsOn ^build`, not in `test`), so `bun run evals --strict` works.
- `e2e/support/mock-llm.ts` (additive): `[plan:<base64url>]` scripts in the message; `[show:system]` and `[show:history]`
  echo what the server sent the model.
- `packages/evals/README.md` says what each suite really proves with a mock model and lists every expected failure.

**Suites (62 cases):** baseline 4, tools 8, grounding 4, multi-turn 6, injection 7, isolation 10, approvals 9, files 14.

**Run:** `bun run evals --strict`: 52 passed, 0 gate-failed, 0 soft-failed, 9 expected-failure, 1 skipped, 0 error;
315 checks (295 passed, 18 failed inside expected failures, 2 judged checks skipped). About 44 s with the build cached
(40 s of cases), twice in a row. Gate 85/85; `bun turbo test:e2e` 48 passed.

**Expected failures:** floor rules for pipe-to-shell (not built); symlink read escape and `@file` outside `/work` (074's
known gaps). **Product bugs found, not fixed:** a mentioned file can close its own `<workspace-file>` wrapper (content
unescaped); a write through a symlinked directory fails the run and leaves the chat's bash broken, and through
`sandbox.writeFile` answers 500 with `exec` 500 afterwards; NUL in tool arguments or a tool result fails the run
(`internal`); tool arguments failing the tool's schema fail the run ("couldn't store the answer's parts").
Skipped: hostile MCP tool description (needs a fixture in `packages/mcp`).

**Left:** 085 (judge, live mode); adding `bun run evals --strict` to `gate.sh`; `bun.lock` changed for the new workspace.

## Resolution (2026-10-01, loop)

Merged on Connor's go-ahead ("happy to start merging"), after a rebase and the full local gate (incl. `evals --strict`) and e2e on the rebased branch. [PR #72](https://github.com/connorwforsyth/openchat/pull/72).
