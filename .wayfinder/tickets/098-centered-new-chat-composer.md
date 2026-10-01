---
id: "098"
title: "A new chat has its composer in the middle of the page"
labels: [wayfinder:build]
status: open
assignee: loop
blockedBy: []
---

## Question

Connor asked (2026-10-01): on a new chat the composer should sit centred on the page, not at the bottom; once the chat starts it moves to the bottom, as ChatGPT and Claude do.

## Done when

- With no messages, the composer is vertically and horizontally centred (a little above true centre, as ChatGPT does), with the existing empty-state greeting above it if there is one.
- On the first send it moves to the bottom with one short layout transition (respect `prefers-reduced-motion`: jump), and the conversation appears above it. It never jumps back while a chat has messages; a reload of a started chat renders it at the bottom from the first paint (no flash of a centred composer, server-rendered correctly).
- Attachments, the + menu, the model picker and the Workspace panel all work in both positions; the composer keeps focus through the move.
- Mobile (375px): centred too, and the on-screen keyboard doesn't hide it.
- e2e: new chat → composer centred (bounding box near the middle); send → composer at the bottom; reload → at the bottom immediately. Gate and e2e pass. No `packages/contract` change.

## Owns

`packages/chat-ui/src/chat/**` (layout only), `packages/chat-ui/src/conversation/**` (empty state), `apps/web/app/(app)/(chat)/**` (layout only), `e2e/tests/chat*.spec.ts`.
