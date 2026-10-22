---
id: "176a"
title: "Contract: unread and attention on conversations (only if needed)"
labels: [wayfinder:build]
status: closed
assignee: loop
blockedBy: []
---

## Question

176 needs per-user read state on each chat in the list. If the contract lacks it, add `Conversation.unread`, `markRead`/`markUnread` and `attention` in a contract-only PR.

## Done when

- either a contract-only PR exists (own branch `t/176a-contract-unread`, draft, merged by Connor), or this ticket records why none is needed.

## Owns

`packages/contract/src/schemas/conversations.ts`, `packages/contract/openapi.json`.

## Resolution (2026-10-20)

Not needed: `Conversation.myState.lastReadAt` and `conversations.updateMyState({ lastReadAt })` already exist, so 176 derives unread on the client. No branch or PR was opened. A future `attention` field for background runs would be a new contract ticket.
