---
id: "191"
title: "Spaces: how does a user pick the active space for a chat?"
labels: [wayfinder:task]
status: closed
assignee: loop
blockedBy: []
---

## Question

D17 says every chat has a context. How does a space become one?

## Resolution (2026-10-20, loop, AFK)

The **sidebar space switcher** picks the active space. New chats are created with it as their context (`personal` for the personal space), so its keys pay and usage rolls up there; the chat header can still change it until the first message (D17). The pick is remembered per browser (localStorage). The sidebar's skills/agents lists show what the active space can see, each labelled with the space it came from.

Logged for Connor in [QUESTIONS-FOR-CONNOR.md](../QUESTIONS-FOR-CONNOR.md#spaces).
