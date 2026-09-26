---
id: "005"
title: "Contracts and ports"
labels: [wayfinder:build]
status: open
assignee:
blockedBy: ["002","003"]
---

## Question

Define the frozen interfaces the parallel workstreams build against
(`PLAN.md` §3 step 1, §10 Phase 0 step 5; D4, D8, D17, D18, D26; §7).

- `packages/shared`: `Result<T, E>`, id helpers, small pure utils.
- `packages/contract` (zod, oRPC contract): `MessagePart` union + `partsVersion`, runs and
  run states, conversations and branches, chat context, agents/prompts/skills/MCP and
  their versions, `resource_grant` with per-type permission enums, share links, memory,
  feedback, usage. Emits OpenAPI 3.1.
- `packages/config`: the `app.config.yaml` zod schema (the `PLAN.md` §9 sketch),
  loader, `${ENV}` interpolation, policy bounds; readable errors on invalid config.
- Port interfaces (types only, plus in-memory fakes for tests): `RunExecutor`,
  `StreamChannel`, `Sandbox`, `Storage`, `ProviderRegistry`, `Decider`, `Embedder`,
  `SearchBackend`, `JobQueue`.

Use the risk-check findings from 003 (for example Drizzle RC vs 0.45) where they matter.

## Owns

`packages/contract`, `packages/config`, `packages/shared`, `packages/*/src/ports/`.

## Done when

- Types compile; every schema has round-trip tests; `/openapi.json` generates and passes Redocly lint.
- Each port has an in-memory fake with tests.
- A short `packages/contract/README.md` lists what's in the contract.
- Then 008 (contract review) is ready for Connor.
