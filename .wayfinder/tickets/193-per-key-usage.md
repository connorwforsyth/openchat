---
id: "193"
title: "Spaces: tracking token usage per key"
labels: [wayfinder:task]
status: closed
assignee: loop
blockedBy: []
---

## Question

An admin creates a key in a space and wants usage against that key.

## Resolution (2026-10-20, loop, AFK)

Add a nullable `transaction.provider_key_id`. `recordTransaction` resolves it from the payer scope and the model's provider (the newest key of that scope and provider, which is the one key resolution picks), so no port changes. `spaces.keyUsage` sums tokens and cost per key for a space's keys this month. Older rows have no key and show as "Unattributed".

Logged for Connor in [QUESTIONS-FOR-CONNOR.md](../QUESTIONS-FOR-CONNOR.md#spaces).
