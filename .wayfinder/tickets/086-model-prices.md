---
id: "086"
title: "S3c: a price table so cost is real"
labels: [wayfinder:build]
status: closed
assignee:
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

## Results (2026-10-01, loop)

Built on `t/086-model-prices` (stacked on 080), not pushed, no PR.

**Config.** `models.prices` in `packages/config/src/schema.ts`: a record from
`provider:modelId` ref to `{ inputMicros, outputMicros, cachedInputMicros? }`,
strict, default `{}` (no prices ship). Each is a whole number of micro-USD per
million tokens, 0 to 1_000_000_000_000, the same micro-USD as `costMicros` and
`limitMicros` (the contract's `microUsdSchema`; the admin pages print `$`).
Fractions, negatives, half a price, unknown keys, alias keys and refs whose
provider isn't configured are refused at boot.

**Arithmetic.** `usageCost(prices, model, usage)` in
`packages/config/src/prices.ts` (exported as `@workspace/config/prices`). It is
in `config`, not `server`, because it is a pure function of the parsed config
and a contract `TokenUsage`: all three writers already import `config`, and
anything else holding a config (eval reports) can price usage the same way
without depending on the server. `(input − cached) × inputMicros + cached ×
(cachedInputMicros ?? inputMicros) + output × outputMicros` in BigInt, plus
500_000, integer-divided by 1_000_000: round half up, once per recorded call.
Cached tokens are clamped to the input count; reasoning tokens are inside
output and not charged again; token counts that aren't positive finite
numbers count as 0; the result saturates at `Number.MAX_SAFE_INTEGER`. It
returns `{ costMicros, priced }`, so callers can tell unpriced from free.

**Writers changed** (every `recordTransaction` caller outside tests):
- `packages/server/src/runs/chat-context.ts` `recordRunUsage` (now takes the prices);
- `packages/server/src/http/llm.ts` (the `/api/llm` proxy);
- `packages/server/src/evals/run.ts` (eval runs; `EvalJobDeps.prices`);
- `packages/server/src/services.ts` passes `config.models.prices` to the first and third.

Title generation, embeddings and the Decider record no usage rows at all
today, so there was nothing to price there; left as found.

**Unpriced.** `usageCost` reports `priced: false`, but a stored row can't carry
it without a column (DB) or a field (contract), so on the usage page an
unpriced model and one priced at 0 both read `$0.00`. Documented instead.

**Budgets.** Not changed. They compare `balance.spent_micros` with the limit
(`used >= limit`), and `recordTransaction` adds `costMicros` to the balances,
so a budget with a limit above 0 was inert while cost was 0 and is enforced
from the first priced call on instances that set prices: a hard one answers
402 `BUDGET_EXCEEDED` to the next run (any model, priced or not). Pinned in
`packages/server/src/runs/cost.test.ts` and called out in
`docs/self-hosting.md`. Found on the way: `limits.budgets` in the YAML is
parsed but read nowhere, so only budgets set in Admin exist.

**Not modelled.** Cache-write surcharges (usage rows have no cache-write
count) and per-key or per-org prices (one price per model, whoever's key paid).

**Also touched outside Owns, minimally:** `packages/config/package.json` (one
export line), `packages/server/src/services.ts` (wiring),
`packages/server/src/testing/harness.ts` (a `prices` option for tests). No
change to `packages/contract`, no migration, no new dependency.
`app.config.example.yaml` has no prices example (not in Owns).

**Verified.** `gate.sh`: check clean, guards clean, `Tasks: 82 successful, 82
total`. `E2E_PORT=3186 bun turbo test:e2e`: 48 passed. New tests: 17 in
`packages/config/src/prices.test.ts` (rounding, missing price, free vs
unpriced, cached, zero usage, very large counts, schema refusals), 5 in
`packages/server/src/runs/cost.test.ts` (priced run is non-zero, unpriced is
0, the proxy, two budget cases), and the eval-run test now asserts its rows'
cost.

## Resolution (2026-10-01, loop)

Merged on Connor's go-ahead ("happy to start merging"), after a rebase and the full local gate (incl. `evals --strict`) and e2e on the rebased branch. [PR #71](https://github.com/connorwforsyth/openchat/pull/71).
