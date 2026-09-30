---
id: "095"
title: "Offer every model a provider serves, restricted by admin patterns"
labels: [wayfinder:build]
status: open
assignee: loop
blockedBy: []
---

## Question

Connor asked (2026-10-01) for the picker to offer the full set of models, not only the few named in `app.config.yaml`. Today `ProviderRegistry.listModels` returns Auto, the aliases and `providers.<name>.models` (`packages/ai/src/providers/registry.ts`). Showing every model a provider serves means spending decisions move to whoever picks, so it is opt-in per provider and admins can narrow it.

## Done when

- Per provider in config: `discover: false | true` (default false, so existing instances see no change) plus optional `include` / `exclude` glob patterns over model ids (e.g. `include: ["anthropic/*", "openai/gpt-5*"]`).
- When on, the registry lists the provider's catalog: openai-compatible (incl. the gateway) via `GET {baseURL}/models`, Ollama via its tags endpoint, and the direct Anthropic / OpenAI / Google list-models APIs, each with that provider's configured key (instance key, or the chat's resolved key when BYOK applies — never a key the caller couldn't already use). Keep any metadata the catalog returns (display name, description, context window) on the server side for 096.
- Cached per provider and key (default 1 hour, configurable), fetched with a short timeout; a provider that fails to answer falls back to its configured `models` and logs once. `listModels` stays synchronous for callers or becomes async with every caller updated — say which.
- Discovered models are real selectors: a run can use one, and a model outside the allowed patterns is refused by the server (not only hidden).
- Unit tests with mocked catalogs (openai-compatible, Ollama, one direct provider), the pattern rules, the cache and the fallback; no real network call in tests. Docs in `docs/self-hosting.md`. Gate and e2e pass. No `packages/contract` change (the `ModelOption` shape is unchanged).

## Owns

`packages/ai/src/providers/**`, `packages/ai/src/ports/provider-registry*.ts`, `packages/config/src/schema.ts` (the provider `discover`/`include`/`exclude`/cache keys only), `packages/server/src/api/meta.ts` (listing), the run path's model check, `docs/self-hosting.md`, tests.
