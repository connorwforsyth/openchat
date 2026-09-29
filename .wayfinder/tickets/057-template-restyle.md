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

## Results

Built on `t/057-template-restyle`; `status` stays `open` for review.

**Primitives.** `bubble` and `item` added to `packages/ui` with the shadcn CLI (base-nova registry). Bubble's `tinted` variant is left out (its `oklch()` literals fail the tokens guard); both use logical utilities.

**Messages.** A `max-w-2xl px-6 gap-6` column. User turns are a muted `rounded-3xl` Bubble, at most 80% wide and end-aligned. Assistant turns are 15px/1.75 prose with no avatars. `.is-user` / `.is-assistant[data-message-id]` are unchanged. "Thinking…" (and the reasoning trigger's) pulses in opacity instead of shimmering. The scroll-to-bottom button is round.

**Empty state.** "What can I help with?" and 4 localised suggestions, which send as the first message (hidden while the composer is disabled). `ConversationView` now shows the empty state even when given an error slot: `ConnectedChat` always passes `<RunError>`, which renders nothing, so the real app never showed a new chat's intro before.

**Composer.** A `rounded-2xl bg-input/50` frame with a `ring-3 ring-ring/30` focus ring (on both the shell's textarea and the editor). The bottom row has Attach and the model picker at the start; the context chip and a round Send (arrow up) or Stop at the end. `ChatScreen` passes the context to the composer only while it's unlocked.

**Header (new D14).**
- Before: toggle, New chat (sidebar collapsed); centre title and branches; end context chip, avatars, Share, "Sandbox: …" pill, Artifacts button (up to 7).
- After: start has the toggle, New chat (sidebar collapsed), title and branch switcher. End has Share, with avatars on the button and the locked context (`ContextSummary`) in its menu, and one Workspace toggle (`aria-pressed`, reopening the panel's last tab, sandbox first).
- Narrow screens: a "More actions" menu with Workspace, Invite, Copy link and the locked context.
- At most 4 buttons besides the title and branch switcher; a unit test checks this.
- `header/sandbox-pill.tsx` is deleted.
- PLAN.md D14's web layout is rewritten.

**E2E.**
- `support/chat.ts` has new helpers: `chatHeader`, `contextChip` (scoped to the composer), `lockedContext` (the Share menu group) and `openWorkspace`.
- `context.spec` picks the context in the composer and checks the locked one in Share.
- `shell.spec` has a new header and empty-state test.
- Two specs outside this ticket needed minimal fixes:
  - `sandbox.spec`: the "Sandbox: " pill became `openWorkspace(page, "Sandbox")`.
  - `orgs.spec`: the chip is now in the composer, which the editor replaces, so it waits for `composerReady` and uses `contextChip`.

**Verified.**
- Gate: `gate.sh` passes (82/82 turbo tasks).
- Unit tests: chat-ui 103, composer 67 and ui 2 all pass.
- E2E: `E2E_PORT=3457 bun turbo test:e2e` passed 26 of 26.
- Screenshots of the `/dev/chat` demo cover wide, empty (light and dark), the Share menu, the Workspace panel open, and narrow with its overflow menu.

**For 060/062.**
- The Workspace toggle opens today's `RightPanel` and remembers its last tab. 060 can swap the panel without touching the header.
- The S and A shortcuts still open the Sandbox and Artifacts tabs directly.
- Streamdown still renders its own markdown styles; `typeset.css` from the template was not ported, because it lives in globals.css.
