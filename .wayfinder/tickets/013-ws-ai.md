---
id: "013"
title: "WS-ai: providers, keys, agent runner and Decider"
labels: [wayfinder:build]
status: open
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
