---
id: "176"
title: "Sidebar “Needs attention” section and unread"
labels: [wayfinder:build]
status: in-progress
assignee: loop
blockedBy: []
---

## Question

From the ChatGPT sidebar study (`.context/research/chatgpt-dots-and-sidebar.md`, B1.4, idea 5): one section for chats that are running, awaiting approval or unread, with keys to jump between them and clear them.

## Done when

- the section lists running, awaiting-approval and unread chats, and hides when empty;
- Mark unread works from the row menu and ⇧⌘U;
- ⌥⌘A jumps to the next chat that needs attention, and ⇧Esc clears unreads;
- read state updates optimistically (D28).
- **Tests:** pure `attentionFor` / `needsAttention`, browser-mode section tests.

## Owns

`packages/chat-ui/src/sidebar/**`, `packages/chat-ui/src/model/attention.ts` (new, pure). Contract via 176a only if needed.
