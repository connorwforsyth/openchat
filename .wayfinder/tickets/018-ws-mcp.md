---
id: "018"
title: "WS-mcp: MCP connection manager"
labels: [wayfinder:build]
status: open
assignee: loop
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
