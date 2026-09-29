---
id: "062"
title: "Wire it together, plus e2e"
labels: [wayfinder:build]
status: open
assignee:
blockedBy: ["058", "059", "060", "061"]
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
- `chat-ui/src/chat/{connected-chat,chat-screen}.tsx`;
- `apps/web/app/(app)/(chat)/chat-route.tsx`;
- `e2e/tests/sandbox.spec.ts`, renamed to `workspace.spec.ts`;
- `e2e/tests/files.spec.ts`;
- `e2e/support/mock-llm.ts`.

**Changes:**
- **Mentions:** file mentions are sent as `data-workspace-file` parts.
- **Attachments:** each is uploaded, then `importFile`d, and a mention is added for it.
- **Commands:**
  - `/new-file` creates an empty file and opens it.
  - `/open` opens a file.
  - `/preview` opens the recorded preview if there is one. Otherwise it sends the localised prompt "Start the app and open a preview". It's hidden on just-bash-only instances.
  - File commands are disabled until the chat exists.

**Done when** these pass on the mock model (steered by `[tool:…]`):
- a fresh chat with `[tool:write …]` shows a card, and Open shows the file in the tree and editor;
- an edit made in the panel survives a reload;
- `@hello.md` puts the file's content into the reply;
- an attached file shows up in Files;
- `/new-file` works;
- `[tool:bash …]` shows "Ran …", and there is no Terminal;
- per-hunk review still works, seeded with `sandbox.writeFile`.

## Notes from 061 (also in scope here)
- Pass relative workspace paths (no leading `/`, no spaces) as `files`; `onCommand("open")` arrives without a path when `files` is empty, so open the Files panel.
- File mentions reach `onSubmit` as `value.mentions[i] = {kind:"file", path, label, start, end}`; send them as `data-workspace-file` parts (056).
- Fix: TipTap's suggestion briefly reports an empty list while loading, so an Enter in that gap submits instead of choosing. Ignore `loading` updates in `packages/composer/src/hooks/use-suggestion-menus.ts`, with a test.
- Update the composer's screen-reader hint ("Type / for prompts and @ to mention someone") and `packages/composer/README.md` for the file features and the new context-chip placement.
- Additional Owns: `packages/composer/src/hooks/use-suggestion-menus.ts`, `packages/composer/src/components/composer.tsx` (hint only), `packages/composer/README.md`.
