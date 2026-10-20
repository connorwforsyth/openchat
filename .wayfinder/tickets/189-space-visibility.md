---
id: "189"
title: "Spaces: what content is visible between parent, child and sibling spaces?"
labels: [wayfinder:task]
status: closed
assignee: loop
blockedBy: []
---

## Question

A skill, agent or chat shared to a space: who sees it?

## Resolution (2026-10-20, loop, AFK)

**Flows down only** (D13, D17: a grant to Engineering includes Engineering › Platform). Members of a space see what is shared to it and to every ancestor space. Nothing flows up (a parent's members don't see a child's content unless they're members there) and nothing flows sideways. A person in several spaces sees the union. Org owners and admins are members of every space in their org for listing purposes (metadata only for private chats, D17 admin visibility). Sharing is a `resource_grant` to the space as principal; library items get `use`, chats `viewer`.

Logged for Connor in [QUESTIONS-FOR-CONNOR.md](../QUESTIONS-FOR-CONNOR.md#spaces).
