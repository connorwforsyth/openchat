---
id: "096"
title: "A short description under each model in the picker (needs a contract field)"
labels: [wayfinder:build]
status: closed
assignee:
blockedBy: ["094", "095"]
---

## Question

Connor asked (2026-10-01) for a short description under each model so people know why they'd pick it. The picker gets its list from `meta.models`, whose `ModelOption` (`packages/contract/src/schemas/models.ts`) has no description or provider field, so this needs an additive contract change, Connor approved the additive contract change on 2026-10-01.

## Done when

- `ModelOption` gains optional `description` (short, one line) and `provider` (for grouping and the logo); old clients ignore them.
- Descriptions come from, in order: config (`models.descriptions.<alias or ref>`, and `auto` gets a built-in one-liner in the UI strings), then the provider's catalog when discovery ([095](095-model-discovery.md)) returns one.
- The 094 dialog shows them. Tests for precedence and the contract round trip. Gate and e2e pass.

## Owns

`packages/contract/src/schemas/models.ts` (after approval), `packages/ai/src/providers/registry.ts`, `packages/config/src/schema.ts` (descriptions), `packages/composer/src/components/target-picker.tsx`.

## Results (2026-10-01, loop)

Built on `t/096-model-descriptions` (from `t/095-model-discovery` with `t/094-composer-plus-menu` merged in). Not pushed.

- **Contract (additive, approved 2026-10-01).** `modelOptionSchema` gains `description: z.string().optional()` and `provider: providerIdSchema.optional()`; nothing else in `packages/contract` changed beyond the regenerated `openapi.json` (those two properties, neither required), the `modelOptions` fixture, and two schema tests (new fields survive; old shape still parses).
- **Config.** `models.descriptions`, keyed by alias or `provider:model` ref, checked at boot like any model reference; `auto` is refused (its line is the UI's own string).
- **Server.** `packages/ai/src/providers/describe.ts`: `oneLine` (first non-blank line, whitespace collapsed, cut at a word to 120 chars with `…`) and `vendorOf` (the vendor after an aggregator's colon, else the provider key). `buildRegistry().listModels` fills both on every option with a ref. Precedence: config by selector (alias), then config by the ref it resolves to, then the discovered catalog's description; otherwise none.
- **Dialog.** `modelVendor` uses the server's `provider` when present and keeps the ref derivation for older servers; choices carry `description` (shown in 094's second-line slot) and search matches it.
- **Setup.** `bun run setup` prunes a description whose alias or provider it removed (the config would now refuse it), like it prunes aliases. Outside Owns; needed because the boot check is strict.
- **Docs.** `docs/self-hosting.md` "Model descriptions"; `app.config.example.yaml` describes `fast` and `strong`.
- **Tests.** `describe.test.ts` (7: line/cap, vendor, precedence config > catalog, catalog fallback, no-discovery, config key checks), `meta.test.ts` round trip through the contract's output schema (fails if the field is removed from the contract), contract schema tests (2), composer options (2) and a dialog test showing and searching a description line; setup snapshot and prune assertion.
- **Verified.** `gate.sh`: check clean, guards ok, `turbo typecheck lint test build` 82/82. `E2E_PORT=3196 bun turbo test:e2e`: 56 passed.

Open: the example's `strong: Hard problems and long documents` survives when setup points `strong` at a small local model (it describes the role, not the model). Anthropic's, OpenAI's and Ollama's catalogs have no descriptions, so only config lines show for them.

## Resolution (2026-10-01, loop)

Merged on Connor's go-ahead ("happy to start merging"), after a rebase and the full local gate (incl. `evals --strict`) and e2e on the rebased branch. [PR #77](https://github.com/connorwforsyth/openchat/pull/77).
