---
id: "102"
title: "Get a run ready while the person types, so Send starts streaming sooner"
labels: [wayfinder:build]
status: open
assignee: loop
blockedBy: []
---

## Question

From performance.dev/chatgpt (Connor, 2026-10-01): ChatGPT completes its pre-send work while the person types, so submission feels instant. Our first token is about 850ms median in e2e (`e2e/support/timings.ts`). Some of that is work that doesn't depend on the final text: resolving the model and key, making sure the chat's workspace is up (`ensureWorkspace`), and loading the agent, tools and MCP connections.

## Done when

- **Measure first:** break first-token latency down into phases (create the chat, resolve the model and key, workspace, the retrieval gate/Decider, tool and MCP setup, provider time to first byte), with server timing marks, and record the baseline in the ticket.
- **Warm while typing:** once the composer has text (debounced; not on every key), the client asks the server to warm the chat's turn: resolve the target and key, ensure the workspace, connect MCP servers, load the agent version. All of it is cached briefly (about 60s) per conversation, target and user, so the run reuses it.
  - Prefer an existing endpoint. If a new route is unavoidable, it is one additive, read-only "prepare" route; stop and report before adding it.
- **No side effects:** warming creates nothing the person can see. A new chat isn't created until Send; its id is generated client-side (UUIDv7, D28). Warming never spends tokens or calls a model, and the Decider still runs on the final text.
- **Cancelled or changed:** if the person changes the target, or the context changes, the warm-up is discarded.
- **Result:** first-token median improves measurably in e2e (report before and after), with no change in behaviour.
- Gate and e2e pass.

## Owns

`packages/server/src/runs/**` (turn resolution and caching only), `packages/chat-ui/src/chat/**` (the warm-up trigger), `packages/client/src/**`, `e2e/support/timings.ts`, tests.
