---
id: "008"
title: "Contract review"
labels: [wayfinder:grilling]
status: closed
assignee:
blockedBy: ["005"]
---

## Question

**HITL gate.** Connor reviews the contracts and ports from 005 before the M1 workstreams
fan out against them. Is the `MessagePart` union right? The run states? The grant model
and permission enums? The config schema? Anything missing that a workstream will need?

Resolve by grilling with Connor. The loop never closes this ticket.

## Done when

Connor has approved the contracts (with any changes made in a follow-up PR).

## Resolution (2026-09-26, Connor)

Accepted all seven recommendations:
1. UUIDv7 ids everywhere, including users and orgs (Better Auth `generateId`).
2. Tool call and tool result stay separate message parts.
3. Only agents, prompts and skills are versioned; MCP servers and presets are edited in place.
4. Orgs, members and invitations go through our procedures, which wrap Better Auth.
5. Add the `/api/llm` proxy to the contract now (a follow-up contract PR, needed by 013); the collaboration events SSE waits for its wave.
6. Missing-config defaults: brand "Chat", public links off, web search off, Ollama on localhost when no providers are set.
7. Older stored messages are read through a union of `partsVersion`s and upgraded on read.
