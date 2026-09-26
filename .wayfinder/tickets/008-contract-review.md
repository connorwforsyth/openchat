---
id: "008"
title: "Contract review"
labels: [wayfinder:grilling]
status: open
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
