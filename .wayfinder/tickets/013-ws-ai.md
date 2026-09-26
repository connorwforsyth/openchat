---
id: "013"
title: "WS-ai: providers, keys, agent runner and Decider"
labels: [wayfinder:build]
status: closed
assignee:
blockedBy: ["008", "027"]
---

## Question

The provider registry driven by `app.config.yaml`, model aliases, `resolveChatKeys`, the agent
runner (`ToolLoopAgent`), the tool registry, the Decider port with the `llm-fallback` adapter
(auto routing and retrieval gating), and the `/api/llm` proxy (`PLAN.md` D2, D3, D15, D17).

Also, from 027: `/api/llm` must refuse file URLs in prompts (no server-side fetching of arbitrary URLs for the caller: SSRF), and may accept `auto` as the model (routed by the Decider).

## Owns

`packages/ai` (except `evals/`).

## Done when

Everything is tested with `MockLanguageModelV4` and `Experimental_EvaluationMockModelV4`;
there are no real provider calls in tests, and it works with no keys configured.

## Resolution (2026-09-27, loop)

Merged in [PR #11](https://github.com/connorwforsyth/openchat/pull/11): `packages/ai` provider registry (openai, anthropic, google, azure, bedrock, openai-compatible; aliases; picker options), `resolveChatKeys` (D17 order), the `MessagePart` ↔ UI message mapper (approvals map to SDK states; per-hunk review stays ours), `runAgent` over `ToolLoopAgent` (succeeded / awaiting_approval / failed / cancelled), `resolveTools`/`buildToolSet`, a Decider on `experimental_evaluate` with an llm-fallback evaluator (auto routing, retrieval gate; proven only-stricter), `handleLlmProxy` (refuses file URLs and provider file refs, rejects provider-executed tools), `generateTitle`. Verified: 41/41 turbo tasks, 200 tests on mock models, empty-env import test, CI passed. Questions 19–20 logged.
