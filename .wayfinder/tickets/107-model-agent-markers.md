---
id: "107"
title: "A marker in the chat where the model or agent changes"
labels: [wayfinder:build]
status: open
assignee: loop
blockedBy: ["099"]
---

## Question

Connor (2026-10-01): when you switch models in a chat, show a marker in the conversation; the same when switching agents. Each message already records `model` (the resolved ref) and `agent` (`packages/contract/src/schemas/messages.ts`), so this is client-only.

## Done when

- **Where a marker appears:** on the active path, before an assistant message whose `model` or `agent` differs from the previous assistant message's. The first reply has no marker.
- **What it looks like:** a quiet centred divider: a hairline, the brand mark (099's `BrandMark`, letter fallback) and the display name ("Claude Opus 5"), or the agent's name and icon. If both changed, the agent wins and the model shows muted after it.
- **Name lookup:** from the model list (`displayName`), falling back to a tidied ref. Agents come from the library; deleted ones show "Removed agent".
- **Accessibility:** a separator with a label ("Switched to Claude Opus 5"); excluded from copy-all; never a message.
- **Branches:** the markers follow the branch you're viewing.
- **Tests:** markers at changes only, agent and model cases, branch switching, and an e2e test that switches model mid-chat and sees one marker. Gate and e2e pass. No `packages/contract` change.

## Owns

`packages/chat-ui/src/conversation/**`, `packages/i18n/locales/**`, `e2e/tests/chat*.spec.ts`.
