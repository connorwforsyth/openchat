---
id: "085"
title: "S3b: a pluggable judge and live mode"
labels: [wayfinder:build]
status: open
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
