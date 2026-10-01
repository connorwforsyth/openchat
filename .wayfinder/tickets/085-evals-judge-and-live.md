---
id: "085"
title: "S3b: a pluggable judge and live mode"
labels: [wayfinder:build]
status: closed
assignee: 
blockedBy: ["084"]
---

## Question

Part of [081](081-evals-v2.md) (S3 of `docs/proposals/2026-09-30-eve-assessment.md`, section "S3 · Evals v2" and "Eval plan (S3)").
The model-judged half. It must work with any configured model and never need AI Gateway or a Vercel account.

## Done when

- A judge module in `packages/ai/src/evals/`: takes any configured language model (direct provider, openai-compatible, Ollama)
  and scores an answer against criteria, returning a score, a verdict and the reasoning. Tested with a mock judge model.
- `t.judge(criteria)` in `packages/evals` uses it; judge scores are **soft** by default.
- Live mode: `bun run evals --live --model <alias> [--judge <alias>]` uses real providers from `app.config.yaml`. It is opt-in,
  never runs in the gate, and prints what it will call and an estimated cost before it starts.
- `LLM_JUDGE_SCORER` in `packages/server/src/evals/run.ts` uses the same judge module.
- The **J** checks from the plan's eval table are written against it.
- Gate passes with no keys and no network. No live call is made while building this ticket.

## Owns

`packages/ai/src/evals/**`, `packages/evals/**`, `packages/server/src/evals/run.ts`.

## Results (2026-10-01, loop)

Built on `t/085-evals-judge` (stacked on 084 ← 080 ← 078 ← 079), unpushed. No live model call, provider call or key was
used; live mode was proven against the e2e mock model behind an openai-compatible provider.

- **Judge module** `packages/ai/src/evals/judge.ts` (`@workspace/ai/evals/judge`): `createJudge({ model, timeoutMs?,
  maxRetries?, name? })` over any `LanguageModelV4` → `judge({ criteria, transcript, context?, signal? })` →
  `Result<{ pass, score 0–1, reasoning, usage }, { type: timeout | unavailable | invalid_verdict, message }>`. It uses
  `generateText` + `Output.object` (structured output), not `experimental_evaluate`: ai@7.0.116 has that API, but its
  answers carry no reasoning and openai-compatible (so Ollama) providers ship no evaluation model. The transcript is
  data to the judge, never instructions. `packages/ai/src/evals/model.ts` resolves an alias/ref from app.config.yaml
  with the provider's instance key. Tests: mock model only (well-formed pass/fail, 5 malformed outputs, timeout,
  provider error without retry, cancel, prompt contents): 16 tests.
- **`t.judge(criteria, { context })`** goes through the seam (`src/judge.ts` now re-exports the module's types). Soft
  unless `.gate()`; counted even without `.soft()`; skipped without a judge; a judge error fails the check (never
  passes). The report carries the score and reasoning (`score` on judged assertions; `mode: deterministic | live`,
  `model`).
- **Live mode**: `--live --model <alias> [--judge <alias>] [--yes] [--allow-ci]`. Refuses in CI without `--allow-ci`;
  prints provider, type, endpoint and the env variable names its key comes from (never values), the case count and a
  rough token estimate (no cost: `@workspace/config/prices` isn't on this branch); calls nothing without `--yes` (or
  a yes at an interactive prompt); refuses a keyed provider whose key is unset. Boots apps/web itself
  (`src/live-server.ts`) with the person's providers and aliases copied as written and only the env vars they name,
  the model under test as default, and the e2e stand-ins for embeddings and search.
- **J checks**: 7 `liveCase`s: baseline 2 (helpfulness/faithfulness), tools 2 (ambiguous prompts: notes → read,
  "check online" → web_search), grounding 1 (no unsupported claims, file as `context`), injection 2 (didn't follow
  injected instructions, plus gates on pipe-to-shell and `/etc`). In a deterministic run they're skipped as "live only".
- **`LLM_JUDGE_SCORER`** (`packages/server/src/evals/run.ts`): with a new optional `judgeModel` dep, rubric cases are
  judged with `createJudge` on a model loaded like the answer's (requester's keys; judge usage recorded); a judge
  error is stored unscored with its type. `services.ts` doesn't pass `judgeModel`, so behaviour is unchanged today.

**Verification:** gate 85/85. `bun run evals --strict`: 69 cases: 52 passed, 9 expected-failure, 8 skipped (the 1 from
084 + 7 live-only), 0 failed; 315 checks: 295 passed, 18 failed (inside expected failures), 2 skipped: identical to
084 apart from the 7 skipped live cases. `bun turbo test:e2e`: 48 passed. Mock-backed live runs: without `--yes` it
prints the plan and exits 2; with `CI=true` it refuses; with a keyed provider whose variable is unset it refuses; with
`--yes` it boots, runs the 7 cases (14 deterministic checks pass) and reports all 7 judged checks as soft failures
"the judge failed (invalid_verdict)", since the mock echoes instead of answering JSON.

**Open:** turbo passes the evals task only `CI` and `EVALS_PORT`, so under `bun run evals --live` neither `CONFIG_PATH`
nor provider keys arrive; documented to use `bun packages/evals/src/cli.ts --live …` (fixing it is a `turbo.json`
change, outside Owns). Wiring `judgeModel` in services needs a config key (e.g. `evals.judgeModel`, a schema change).
Cost estimate once 086 merges. The first real run and judge quality are 087. No hostile-web-result live case (the
search stand-in only echoes the query).

## Resolution (2026-10-01, loop)

Merged on Connor's go-ahead ("happy to start merging"), after a rebase and the full local gate (incl. `evals --strict`) and e2e on the rebased branch. [PR #73](https://github.com/connorwforsyth/openchat/pull/73).
