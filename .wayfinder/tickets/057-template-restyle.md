---
id: "057"
title: "Template-style restyle and a slimmer header"
labels: [wayfinder:build]
status: open
assignee: loop
blockedBy: []
---

## Question

Part of the chat workspace and UI cleanup Connor asked for on 2026-09-29 (plan: `~/.claude/plans/should-we-use-wayfinder-functional-perlis.md`). Background, shared by 055–062:

After trying the M1 demo, Connor asked for two things.

1. **Clean up the UI**, using [shadcn-ui/chatbot-template](https://github.com/shadcn-ui/chatbot-template) as inspiration. That template is a lean single-page chat:
   - a narrow column;
   - user messages as muted bubbles, assistant replies as plain prose, no avatars;
   - a rounded composer with the model picker and send button on its bottom row;
   - tool calls shown as quiet status lines, never raw;
   - an empty state with suggested prompts.
2. **Fix how chat and sandboxes fit together.** Today the link feels unclear and fragile, and bash and the terminal are exposed to users. Instead, users should prompt, create and edit files from the composer.

**What the research found:**
- **The UI exposes raw machinery.**
  - The header has up to 7 controls, including a "No sandbox" pill.
  - The side panel has a terminal for running commands directly, a box for typing a port number, and a status/isolation badge.
  - Tool calls in messages show up as raw JSON cards.
- **The link breaks in two places** (root causes):
  - A plain chat only gets file tools after someone clicks "Create sandbox". The composer never sends `options.sandbox` (`connected-chat.tsx` `runFields`), and `turn.ts` `chatSandboxTools` requires it.
  - `turn-tools.ts` `rowFor` returns a `failed` row as it is, so one failed start blocks the chat until someone presses Reset.
- **The header pill and the panel drift apart.** The panel keeps its own copy of the sandbox (`use-sandbox-panel.ts`), while the pill reads the query.

**Connor's decisions:**
- **Always-on workspace:** every chat has a Files workspace, created silently on first use. There's no "Create sandbox" button.
- **No terminal:** it's removed from the UI. The model still uses bash internally.
- **Composer file features:** `@`-mention files, drop or attach files into the workspace, edit files directly in the panel, and `/` file commands.
- **No prototype:** build straight away. This changes PLAN.md D14, the header layout.

**Useful findings:**
- **File mentions need no contract change.** User messages already accept `data` parts, whose shape is owned by the feature that sends them.
- **The editor already exists.** `@pierre/diffs` 1.5.1 has one (`File` with `edit`, `onEditChange` and `onEditComplete`), so there's no need for CodeMirror or Monaco.
- **Nothing is renamed.** The router keeps the name `sandbox`; "Workspace" and "Files" are labels in the UI only.

## This ticket

**Owns:**
- `bubble` and `item` in `packages/ui/src/components/`, added with the shadcn CLI or copied from the MIT template;
- `ai-elements/message.tsx`;
- in `packages/chat-ui/src/`: `conversation/**` (except `tool-part`, `approval` and `actions`), `header/**`, `chat/chat-screen.tsx`, `shell/app-shell.tsx`, `sidebar/**`;
- the composer's `composer-shell`, `composer-footer`, `context-chip`, `target-picker` and `styles.ts`;
- `PLAN.md` D14;
- `e2e/tests/{shell,chat,context}.spec.ts` and `e2e/support/chat.ts`.

**Changes:**
- **Messages:** a column of `max-w-2xl px-6 gap-6`. User messages are a muted `rounded-3xl` bubble, at most 80% wide and aligned to the end. Assistant replies are prose at 15px/1.75. The `.is-user` and `.is-assistant[data-message-id]` classes stay.
- **Composer:** a `rounded-2xl bg-input/50` frame with a `ring-3 ring-ring/30` focus ring. Its bottom row has Attach and the model picker at the start, and the context chip (while unlocked) and Send/Stop at the end.
- **Empty state:** "What can I help with?" and 4 suggested prompts.
- **Thinking indicator:** "Thinking…" pulses in opacity. A shimmer would break the D28 motion rule.
- **Scroll button:** a round scroll-to-bottom button.
- **Header (the new D14):**
  - Start: sidebar toggle, New chat (only while the sidebar is collapsed), the title, and the branch switcher (only when the chat has branches).
  - End: **Share** (with participant avatars; a locked context also shows here) and a single **Workspace** toggle.
  - Removed: the sandbox pill and the Artifacts button.
  - Narrow screens: an overflow menu.

**Done when:** the header has at most 4 controls, the e2e specs use the new selectors (the "Chat context" chip is found in the composer), and the tokens, Lingui and motion guards pass.
