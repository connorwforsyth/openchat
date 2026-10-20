---
id: "192"
title: "Spaces: how does a team token allowance work?"
labels: [wayfinder:task]
status: closed
assignee: loop
blockedBy: []
---

## Question

A per-space budget, and members drawing on it with the owner's permission.

## Resolution (2026-10-20, loop, AFK)

A **monthly token pool per space** (`space_allowance.monthly_tokens`, set by an owner). A member draws on it only with an **approved grant** (`space_allowance_grant`: requested tokens per month, status pending | approved | denied, decided by an owner). `allowanceFor(user, space, grants, usage)` is pure: remaining = min(grant left, pool left). Tokens, not money, because Connor said token allowance; money budgets (D24) stay as they are. Enforcement before a run is a follow-up: the demo shows and approves allowances but runs are still gated by money budgets only.

Logged for Connor in [QUESTIONS-FOR-CONNOR.md](../QUESTIONS-FOR-CONNOR.md#spaces).
