---
id: "146"
title: "MCP tool results are capped, and a test measures what a chat sends over the wire"
labels: [wayfinder:build]
status: closed
assignee:
blockedBy: []
---

## Question

From the T3 Code study (`.context/research/t3code/server.md`, recommendation 1). Sandbox output is capped at 256k characters (`packages/sandbox/src/output.ts`), but MCP tool results aren't capped anywhere in `packages/mcp/src`, and every `tool-output-available` chunk goes into `run_chunk` and over SSE (a resume replays all of it). T3 keeps full payloads but projects them down for the wire, and guards that with measured transfer-budget tests (`t3:apps/server/integration/TransferBudgetScenario.integration.ts`).

## Done when

- MCP tool results are capped before they reach the model and the stream, the same way `capOutput` caps sandbox output, with a note the model can read saying the result was cut and by how much. Text and structured content both; images keep their own limit if one exists.
- A server test (PGlite + `MockLanguageModelV4` + a fake MCP tool returning ~1 MB) runs a multi-turn chat and asserts an upper bound on bytes sent over the run SSE stream and on the conversation's path response. The bound is recorded in the test with a comment saying what moves it.
- Gate and e2e pass. No `packages/contract` change.

## Owns

`packages/mcp/src/**` (the result cap), `packages/server/src/runs/**` tests (the budget test), `packages/sandbox/src/output.ts` (only if the cap helper moves to `@workspace/shared`), `packages/shared/src/**` (that helper only).

## Resolution (2026-10-16, loop)

Merged in [PR #118](https://github.com/connorwforsyth/openchat/pull/118): MCP tool results capped; wire-budget test. Verified: full local gate; db boot-migrate timeout under load passed alone. Nothing left on this ticket.
