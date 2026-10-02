---
id: "153"
title: "Switching back to a chat returns to where you were reading"
labels: [wayfinder:build]
status: open
assignee:
blockedBy: []
---

## Question

From the T3 Code study (`.context/research/t3code/web.md`, recommendation 7). `MessageScrollerProvider key={conversationKey}` resets every chat to the bottom on switch, so going back to a long chat mid-read loses your place. T3 keeps a 100-entry in-memory LRU per thread of whether you were at the end, an anchor and its offset, and which sections were expanded (`t3:apps/web/src/components/chat/timelineScrollAnchoring.ts`).

## Done when

- A module-level LRU (~100 entries) keyed by conversation id stores `{ atEnd, anchorMessageId, offset, openIds }` on leave; on return the view restores it (at-end chats still follow new output). Pure store, unit-tested.
- Restoring doesn't animate (instant), works with the persisted cache's instant render, and doesn't fight a run that's streaming.
- Browser test: scroll up in a long chat, switch away and back, same anchor in view.
- Gate and e2e pass.

## Owns

`packages/chat-ui/src/conversation/**` (scroller and a new store), tests.
