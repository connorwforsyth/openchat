---
id: "152"
title: "Queue a follow-up while a reply streams, and send it now (proposal first)"
labels: [wayfinder:grilling]
status: open
assignee:
blockedBy: []
---

## Question

From the T3 Code study (`.context/research/t3code/web.md`, recommendation 3). T3 lets you type the next message while the agent works: it's queued above the composer (with the model and mode it was written for), sent when the turn ends, removable, and Mod+Shift+Enter "steers" it in now (`t3:apps/web/src/queuedMessageStore.ts`, `QueuedMessageSender.tsx`). openchat already has server rules for a message sent during a run (D25, #63's "a new message moves on", 133), so this needs Connor's call on the behaviour before building:

1. While a reply streams, does Enter queue (T3), or start a new run that cancels the current one, or do nothing (today)?
2. Is "send now" a stop-and-send, or does it join the running turn at the next tool boundary (needs the harness to accept input mid-run)?
3. Does the queue live in the browser only, or on the server so another device sees it?
