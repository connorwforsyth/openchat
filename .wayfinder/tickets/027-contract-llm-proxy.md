---
id: "027"
title: "Contract: add the /api/llm proxy"
labels: [wayfinder:build]
status: open
assignee: loop
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
