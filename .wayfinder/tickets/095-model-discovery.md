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

## Results (2026-10-01, loop)

Built on `t/095-model-discovery` (not pushed).

- **Config** (`packages/config/src/schema.ts`): per provider `discover` (default `false`), `include` / `exclude` globs over model ids (`*` crosses `/`, `?` one char), `discoverTtlSeconds` (default 3600). `discover` on `azure` / `bedrock` is a boot error (no catalog). Ollama's tags are used for a provider named `ollama` or with `options.catalog: ollama`.
- **Catalogs** (`packages/ai/src/providers/catalog.ts`): openai-compatible (incl. the Vercel AI Gateway) `GET {baseURL}/models` (drops `type: embedding|image|…`), Ollama `GET {root}/api/tags`, Anthropic `GET /v1/models?limit=1000` (`x-api-key`), OpenAI `GET /v1/models`, Google `GET /v1beta/models?pageSize=1000` (key in `x-goog-api-key`, never the URL; `generateContent` models only). 5 s timeout; errors carry no URL, header or body. Name, description and context window are kept (`CatalogModel`), reachable through `DiscoveringRegistry.catalog()` for 096; the context window also fills `ModelOption.contextWindow` (an existing field).
- **Registry** (`registry.ts`, `patterns.ts`): the catalog is read with the key the chat context resolves (instance per policy, or team/org/user), cached per provider and hashed key (the key itself isn't held as a map key), one in-flight fetch shared; a failure falls back to the configured models, logs once per provider until it answers, and retries after 60 s. Refs the config names (`models`, alias targets, `models.default`, `auto` ends) are always offered and runnable.
- **`listModels` became async** and takes the context's `ChatKeys` (not a provider set). Callers updated: `meta.models`, `keys/verify.ts` (now reads the catalog with the key being verified, so a discover-only provider has a model to test), the memory registry and tests.
- **Run-time refusal**: new port method `checkModel(ref, credentials)` and error `not_offered`. `createModelLoader` (turn.ts) calls it after `languageModel`, so "no key" still reads as before; a ref outside the patterns, or (with `discover`) missing from the catalog or while the catalog is down, fails the run with `provider_unavailable` / "… isn't offered on this instance." The sandbox LLM proxy (`llm-proxy/handle.ts`) does the same. Without `discover` and without patterns, behaviour is unchanged (any id on a configured provider runs).
- **Docs**: `docs/self-hosting.md` "Offering every model a provider serves".
- **Tests**: `catalog.test.ts`, `patterns.test.ts`, `registry-discovery.test.ts` (33, fake `fetch` only), `server/src/runs/model-check.test.ts` (6, loader refusal), `meta.test.ts` (+1: catalog read with the team's key only). Gate 82/82; `bun turbo test:e2e` 44/44 (two earlier full runs under load had `memory.spec` "shared chat" and a workspace per-hunk spec fail; both pass alone and the next full run passed).
- Outside Owns, needed for the signature change: `packages/ai/src/llm-proxy/handle.ts`, `packages/server/src/keys/verify.ts`, `packages/server/src/server.ts` (passes `log`), and test fixtures in `server/src/runs/attachments.test.ts`, `config/src/parse.test.ts`.
- **Open**: `keyedProviders` in `keys/resolve.ts` is now used only by its test. Without `discover`, hand-typed refs outside `models` still run (as before 095) unless `include`/`exclude` is set; tightening that would change existing instances. No e2e spec added (the mock already serves `/models`, but adding a discovering provider would add picker options that 094's specs are changing).
