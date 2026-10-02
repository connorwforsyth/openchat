---
id: "147"
title: "A chat's unsent draft survives reload and switching chats; ArrowUp recalls your last prompt"
labels: [wayfinder:build]
status: open
assignee: loop
blockedBy: []
---

## Question

From the T3 Code study (`.context/research/t3code/web.md`, recommendation 4). A draft lives only in the mounted Tiptap editor, so switching chats or reloading loses it. T3 keeps a draft per thread (300 ms debounce, flushed on `beforeunload`, versioned schema: `t3:apps/web/src/composerDraftStore.ts`) and walks back through the thread's own sent prompts with ArrowUp in an empty composer (`t3:apps/web/src/composerPromptHistory.ts`), derived from the messages so there's no second store.

## Done when

- A `DraftStore` port in `packages/composer` (zod-versioned value; a localStorage adapter and an in-memory fake), keyed by conversation id (and a fixed key for the new-chat composer). Saved debounced, flushed on `pagehide`, cleared on send.
- Switching chats and reloading restore the text, mentions and picked skills of the draft. Attachments aren't persisted (say so in the code).
- ArrowUp in an empty composer, with the caret at the start, fills the previous user prompt on the active branch; repeated presses go further back; ArrowDown goes forward and back to empty. A pure function over the path's messages. Doesn't fire while a mention or slash menu is open.
- Both are in the `packages/shortcuts` registry if they're shortcuts there; all strings through Lingui.
- Browser tests for the store and recall; an e2e check that a draft survives a reload.
- Gate and e2e pass. No `packages/contract` change.

## Owns

`packages/composer/src/**`, `packages/chat-ui/src/chat/composer-dock.tsx` and `connected-chat.tsx` (wiring only), `packages/shortcuts/src/**` (registry entries only), `e2e/tests/composer-drafts.spec.ts` (new).
