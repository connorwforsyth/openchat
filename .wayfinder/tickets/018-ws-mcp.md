---
id: "018"
title: "WS-mcp: MCP connection manager"
labels: [wayfinder:build]
status: closed
assignee:
blockedBy: ["013"]
---

## Question

Port LibreChat's `packages/api/src/mcp/*` (MCPManager, UserConnectionManager, OAuth,
registry) onto `@ai-sdk/mcp`, with org, team and user scopes and encrypted tokens
(`PLAN.md` D1, §8 MCP). Attribute it in `NOTICE`.

## Owns

`packages/mcp`, `NOTICE`.

## Done when

It connects to a test HTTP MCP server (MSW or a local fixture) and merges tools into an
agent's tool set; OAuth token storage is encrypted and tested.

## Resolution (2026-09-27, loop)

Merged in [PR #14](https://github.com/connorwforsyth/openchat/pull/14): `packages/mcp`, LibreChat's MCP connection logic rewritten as functions over `@ai-sdk/mcp` (shared vs per-user connections, backoff with jitter, circuit breaker, 429 stop, idle eviction, OAuth with PKCE/refresh bound to the user, AES-GCM sealed tokens with rotation), HTTP + SSE (stdio refused server-side), private-network guard, `McpToolSource`, `mcp` handlers; `NOTICE` updated. Verified: 40 tests against a real MCP SDK server; 56/56 turbo tasks; CI passed.
