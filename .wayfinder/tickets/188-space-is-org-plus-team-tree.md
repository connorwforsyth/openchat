---
id: "188"
title: "Spaces: a rename of org + team tree, or a new layer?"
labels: [wayfinder:task]
status: closed
assignee: loop
blockedBy: []
---

## Question

Is a space a new tenancy table, or the existing org and team tree under a new name?

## Resolution (2026-10-20, loop, AFK)

A **product rename**, not a new layer. D17 already calls the personal org the "personal space". A root space is an org (Better Auth keeps owning orgs, members and invitations); a sub-space is a node of our `team` tree (`team.parentId`). A `SpaceRef` is `{ type: org | team, id }`, the same shape as a chat context and a grant principal, so grants, budgets, keys and usage need no migration. An admin with Postgres creates a chain with `bun run --cwd packages/db spaces:chain <org-slug> "A/B/C"` (inserts `team` rows). Tables keep their names; the UI and the `spaces` API say space.

Logged for Connor in [QUESTIONS-FOR-CONNOR.md](../QUESTIONS-FOR-CONNOR.md#spaces).
