---
id: "027"
title: "Contract: add the /api/llm proxy"
labels: [wayfinder:build]
status: closed
assignee:
blockedBy: ["008"]
---

## Question

Contract review decision 5: add the `/api/llm` model proxy to the contract now, because
013 (WS-ai) builds it in M1 and the desktop agent loop calls it later (`PLAN.md` D7, §8
Desktop cowork). Server-held keys, usage counted against the chat context.

Define it the same way the run stream is defined: a documented HTTP operation in
`openapi.json` (streaming text/event-stream response in the AI SDK's provider stream
format, or a JSON response for non-streaming), plus zod schemas for the request
(model ref or alias, chat context, messages/prompt, tools, settings) and typed errors
(`BUDGET_EXCEEDED`, `PROVIDER_UNAVAILABLE`, `FORBIDDEN`). Follow the contract-change
process in `packages/contract/README.md`.

## Owns

`packages/contract`.

## Done when

Schemas with round-trip cases; `openapi.json` regenerated and Redocly-valid; README
updated; CI green. Accepted in the 008 review, so the loop may merge it once CI passes.

## Resolution (2026-09-27, loop)

Merged in [PR #7](https://github.com/connorwforsyth/openchat/pull/7): `LlmProxyRequest` mirrors the AI SDK's `LanguageModelV4CallOptions` (the `@ai-sdk/gateway` proxy shape) plus `model`, required `context` and `stream`; JSON or SSE replies (one SDK stream part per event, `[DONE]`), `x-resolved-model`; opaque content/stream parts; `llmProxyErrors`; hand-added `POST /llm` in OpenAPI. Verified: 35/35 turbo tasks, Redocly valid, CI passed. Follow-ups noted on 013 (refuse file URLs; `auto` model) and question 13.
