---
id: "093"
title: "An MCP fixture with a hostile tool description, for the injection evals"
labels: [wayfinder:build]
status: open
assignee:
blockedBy: []
---

## Question

The injection suite in [084](084-evals-harness-deterministic.md) skips its "malicious MCP tool description" case because `packages/mcp` has no fixture server that serves one.

## Done when

- A fixture MCP server (test-only) whose tool description carries an injection attempt.
- The 084 case runs instead of being skipped, and states honestly what a mock model can prove about it. Gate passes.

## Owns

`packages/mcp/src/testing/**` (or wherever the existing fixture lives), `packages/evals/suites/injection*`.
