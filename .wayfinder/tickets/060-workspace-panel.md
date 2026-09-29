---
id: "060"
title: "One Workspace panel"
labels: [wayfinder:build]
status: open
assignee: loop
blockedBy: ["055", "057"]
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
- `packages/chat-ui/src/sandbox/**`, renamed to `workspace/**`;
- `shell/right-panel.tsx`, `model/layout.ts`, the new `model/workspace.ts`;
- `chat/{connected-chat,use-chat-data,chat-screen}.tsx`;
- `artifacts/**`;
- the new `packages/code-ui/src/code-editor.tsx`, built on the `@pierre/diffs` editor;
- `packages/shortcuts/src/registry.ts` (labels only);
- `packages/palette/src/context-actions.ts`;
- in `apps/web/app/`: `(app)/_shared/sandbox-client.ts`, `(chat)/chat-route.tsx`, `dev/{sandbox,chat}/demo.tsx`.

**Layout:** a list next to a main area. The list holds:
- a pinned **Preview · :port** item, shown only when a preview exists;
- the **Files** tree (`@pierre/trees`);
- an **Artifacts** section. Artifacts stay database rows, not files, because they render on a separate origin (D24).

**Editing:**
- Files open in `CodeEditor`, and Markdown is edited as source.
- It saves on ⌘S and after 800 ms without typing, sending `ifMatch`.
- If the agent changed the file, the save conflicts and shows "Changed by the agent: Reload / Overwrite".
- Binary files and files over 1 MB open read-only.

**Removed:** the Terminal, the port box, the status/isolation badge and "Create sandbox".

**States:**
- **Empty:** "No files yet. Ask for one, drop a file here, or type /new-file", plus a drop zone and a New file button.
- **Failed:** an inline Retry. Reset moves into a "…" menu, behind a confirmation.

**One source of truth:**
- The panel reads the `sandbox.get` query only; there's no local copy.
- Every panel action invalidates `api.sandbox.key()`.
- `workspaceRevision(messages)` counts settled sandbox-tool results as they stream in. When it changes, the file list reloads, and so does the open file unless it has unsaved changes.
- A saved layout of `"artifacts"` is migrated to the Workspace panel with the Artifacts section selected.

**Done when:** the new panel tests pass (replacing `use-sandbox-panel.test`), no Terminal renders, and the region is named "Workspace".
