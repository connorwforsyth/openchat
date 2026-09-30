---
id: "086"
title: "S3c: a price table so cost is real"
labels: [wayfinder:build]
status: open
assignee: loop
blockedBy: ["080"]
---

## Question

Part of [081](081-evals-v2.md) (S3 of `docs/proposals/2026-09-30-eve-assessment.md`, section "S3 · Evals v2" and "Eval plan (S3)").
`costMicros` on usage rows is hard-coded to 0, so budgets, the usage page and eval reports can't show cost.

## Done when

- `models.prices` in config: per model, input / output (and cached input where a provider reports it) per million tokens, in a
  currency-neutral micro unit matching `costMicros`. No prices ship as defaults that could be wrong silently: a model with no
  price costs 0 and is reported as "unpriced", and `docs/self-hosting.md` shows how to set them.
- `costMicros` is computed from a run's usage and the table wherever it is 0 today (`packages/server/src/runs/chat-context.ts`
  and anywhere else usage rows are written). Existing rows are not rewritten; no migration.
- Tests for the arithmetic (rounding, missing price, cached tokens). The usage page and budgets read the same column as before.
- Gate and e2e pass. No `packages/contract` change; if one seems unavoidable, stop and report.

## Owns

`packages/config/src/schema.ts` (prices), `packages/server/src/runs/chat-context.ts` and the usage-writing code beside it, `docs/self-hosting.md`, tests.
