---
id: "056"
title: "Every chat gets a workspace that recovers from failures"
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
- in `packages/sandbox/src/`: `handlers/turn-tools.ts`, `tools/tools.ts`, `paths.ts`;
- in `packages/server/src/runs/`: `turn.ts`, `sandbox.ts`, and the new `workspace-context.ts`;
- the new `packages/ai/src/messages/workspace-file.ts`;
- `packages/client/src/run-transport.ts`;
- `PLAN.md` D7.

**Changes:**
- **Tools always offered:** `chatSandboxTools` offers the tools unless `options.sandbox === "off"`.
- **New `ensureWorkspace`**, next to `start()`:
  - if there's no row, it creates one;
  - if the row is `failed` or `destroyed`, it restarts it in place;
  - if the row is `stopped`, it re-attaches.
  - `rowFor` uses it.
- **Docker fallback:** when Docker is unavailable, a new workspace falls back to just-bash (reusing `providerForTurn`'s `FALLBACK`). An existing workspace never switches provider.
- **Tool names stay** `bash/read/write/edit/preview`; only the descriptions change: the workspace is at `/work` and the user sees it in the Files panel. `modelTurn` adds "never ask the user to run commands".
- **Stale-edit guard:** `write`/`edit` recheck the file's hash when resuming after an approval. If the user edited the file in the meantime, the tool tells the model to read it again.
- **`@file` mentions:** a `data-workspace-file` data part, with `workspaceFileRefSchema` in `@workspace/ai`. The server resolves it: files up to 32 KB are inlined as `<workspace-file path=…>`; larger ones get a note telling the model to use `read`.

**Done when:**
- A plain chat gets the tools, and the first call creates the workspace; `off` means no tools.
- A start that fails and then succeeds recovers without a Reset.
- The Docker fallback works.
- Mention resolution and the stale-edit guard have unit tests.
