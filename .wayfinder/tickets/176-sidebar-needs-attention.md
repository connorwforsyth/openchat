---
id: "176"
title: "Sidebar “Needs attention” section and unread"
labels: [wayfinder:build]
status: closed
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

## Resolution (2026-10-20, branch t/181-sidebar-ux)

Built without a contract change: unread is `lastMessageAt > myState.lastReadAt`, written through the existing `conversations.updateMyState`. Pure `model/attention.ts` (`isUnread`, `attentionFor`, `needsAttention`, `nextNeedingAttention`, `unreadMarker`); the open chat is marked read as messages land (`useMarkReadWhileOpen`). The section lists awaiting approval, failed, running and unread, with a status dot per row (Grok study). Run signals come from `dots.list` (Dot status) and the open chat's active run; background runs in other ordinary chats need a contract field (QUESTIONS 2026-10-20 #4). Keys: ⇧⌘U, ⌥⌘A, ⇧Esc. Tests: `attention.test.ts`, `chat-sidebar-list.test.tsx`.
