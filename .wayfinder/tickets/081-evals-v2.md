---
id: "081"
title: "S3: evals v2, a black-box harness over our own API"
labels: [wayfinder:build]
status: open
assignee:
blockedBy: ["080"]
---

## Question

Stage of the eve assessment (`docs/proposals/2026-09-30-eve-assessment.md`): no migration to eve; adopt its patterns in
our own packages. Connor agreed on 2026-09-30. Read that document's Evidence and "Recommended staged plan" sections first.

**Needs PR #63's `[script:]` mock extension on main.**

## Done when

- Evalite stays for the unit-level suites in `packages/ai/evals`.
- New `packages/evals`: boots the app through `e2e/support/serve.ts`; `t.send(message, {as})`, `t.approve/reject/stop/reload`,
  `t.files()`; assertions with `.gate()` and `.soft()`: `calledTool(name, argsMatcher)`, `notCalledTool`,
  `check(includes|equals|matches)`, `judge(criteria)`; JUnit plus a JSON report in `.evals/<ts>/`.
- **Deterministic mode (CI):** the mock model and recorded fixtures; no keys, no network; under 5 minutes; part of the local gate.
- **Live mode (opt-in):** real providers from `app.config.yaml`; the judge uses any configured `.evaluationModel()` through the
  AI SDK evaluation API (no Gateway requirement; Ollama and openai-compatible work); judge scores are soft by default.
- Suites from the plan's eval table: baseline, tool selection and arguments, grounding, multi-turn, prompt injection,
  tenant isolation, approvals/denial/cancel/reconnect, file boundaries, routing.
- `LLM_JUDGE_SCORER` in `packages/server/src/evals/run.ts` uses the same judge module.
- A price table (`models.prices` in config) so `costMicros` is real and evals report cost.
- Run the judge-quality spike first (30 hand-labelled cases, accept at 80% agreement or better).

## Owns

`packages/evals/**` (new), `packages/ai/evals/**`, `packages/ai/src/evals/**` (judge), `packages/server/src/evals/run.ts`, `packages/config/src/schema.ts` (prices), `packages/server/src/runs/chat-context.ts` (cost), `e2e/support/**`, CI workflow and `turbo.json`.
