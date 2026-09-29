---
id: "062"
title: "Wire it together, plus e2e"
labels: [wayfinder:build]
status: closed
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

## Notes from 058 (also in scope here)
- Wire `actions.onOpenFile(path)` to open the file in the Workspace panel; the path may be workspace-relative.
- The preview line's Open currently opens a new tab; add `onOpenPreview` to open the in-app Preview item instead.
- A tool call with no result, because its run failed or was cancelled, spins forever. Pass "message still streaming" from `message-row.tsx` into `ToolPart` so it settles to a neutral "Stopped" line. Additional Owns: `packages/chat-ui/src/conversation/message-row.tsx`, `tool-part.tsx`, `tool-status.tsx`.
- Do a visual pass in the running app: 058's styling was only covered by e2e.

## Notes from 060 (also in scope here)
- Use `ChatScreen`'s `workspaceHandle` (`openFile`, `openPreview`) for `/new-file`, `/open`, `/preview`, and `onOpenPreview` on the preview status line.
- In e2e, type into the editor by clicking `[data-slot="code-editor"] [contenteditable="true"]`, then wait for "Saved".
- Bug: after viewing an artifact, clicking the same file in the tree doesn't fire a selection change; fix it.
- `apps/web/app/dev/sandbox/page.tsx` copy still says "Sandbox panel"; rename it to Workspace (additional Owns).

## Results

Branch `t/062-workspace-wiring-e2e`, not pushed. `status` stays `open`.

**Composer ↔ workspace** (`chat-screen.tsx`, `connected-chat.tsx`; `chat-route.tsx` needed no change: `ConnectedChat` already has the client and config).
- `ChatScreenWorkspace` gains `paths` (the workspace's files, relative) and `canPreview`. Once the chat exists (`files.kind === "chat"`), `ChatScreen` gives the composer `files` (paths with whitespace left out: the triggers are single words), `commands` (`new-file`, `open`, plus `preview` when `canPreview`) and `onCommand`. A new chat gets none of them.
  - `/new-file` opens the panel's `NewFileDialog` (lazy-loaded on first use), then `writeFile` with `ifMatch: null`, `onChanged`, and `openFile`. A taken name is refused in the dialog.
  - `/open` with a path opens it; without one it opens the panel on Files.
  - `/preview` opens the recorded preview, or sends the localised "Start the app and open a preview".
- `ConnectedChat` lists the files with `sandbox.listFiles` (a query keyed by the workspace, enabled once it's ready or stopped), so the composer has them with the panel closed. It refreshes with everything that invalidates `sandbox.key()`, and when `workspaceRevision` moves (`useWorkspaceInSync`, `cancelRefetch: false`, so it doesn't fight the open panel's own refetch). `canPreview` is the record's provider, or `config.sandbox.default` before there is one, and not `just-bash`.
- File mentions go as `data-workspace-file` parts after the text (`outgoingMessage`, deduplicated); without mentions the message is sent exactly as before.
- Attachments upload as before (file parts kept for every type). When the instance has a default workspace provider, each is also `sandbox.importFile`d, one at a time, before the message goes, and mentioned. A failed import doesn't stop the send. New chats too: the chat is created before its uploads.
- `actions.onOpenFile` (060) is unchanged and verified by e2e. `actions.onOpenPreview(url)` is new: the preview line's Open becomes a button that shows the recorded preview in the panel (or opens the URL in a new tab if the record doesn't have it yet). Without the action it stays a link.

**Fixes from the notes.**
- `use-suggestion-menus.ts`: `keepWhileLoading` keeps the last list, with the new range, through TipTap's `loading` updates, so Enter chooses rather than sends. Tested in `use-suggestion-menus.test.ts`.
- Screen-reader hint: "Type / for commands and prompts, and @ to mention someone or a file." `packages/composer/README.md` covers `files`/`commands`/`onCommand`, file mentions, the bottom row (context chip at the end, only while unlocked) and the loading fix.
- `message-row.tsx` passes `streaming` to `ToolPart`. A running call in a message that has stopped streaming renders `ToolStatus` with `stopped`: the tool's icon, no spinner, a neutral "Stopped" (`data-status="stopped"`), still expandable.
- Tree re-selection: `@workspace/code-ui/file-tree` gets an optional controlled `selectedPath`, and the panel passes the open file (or `null`). The tree drops its selection when an artifact or preview is shown, so clicking the same file fires again. A file opened from the chat also shows as selected.
- `apps/web/app/dev/sandbox/page.tsx`: "Workspace panel".
- **Found in e2e and fixed:** single-key shortcuts fired while typing in the panel's editor. The editor is in a shadow root, so the window listener saw its host as the target, and typing an "n" started a new chat. `use-shortcuts.ts` now checks `event.composedPath()[0]`. Test added; it fails without the fix.

**Outside Owns, minimal and needed:** `conversation/actions.tsx` (`onOpenPreview`), `code-ui/src/file-tree.tsx` + `workspace/workspace-panel.tsx` (the re-select fix), `shortcuts/use-shortcuts.ts` (the shadow-root fix), the catalog.

**Tests.**
- chat-ui 174/174. New:
  - `chat-screen.test.tsx`: `/new-file` → dialog → write → open; `/open` lists files, leaving out spaced names; `/preview` sends the prompt; no `/preview` when `canPreview` is false; no commands in a new chat; shortcuts ignore a shadow-root editor.
  - `tool-part.test.tsx`: Stopped; Open in the app.
  - `workspace-panel.test.tsx`: the tree follows the open file and re-selects after an artifact.
  - `connected-chat.test.ts`: `outgoingMessage` through `userParts`.
- Composer: the new hook test.
- E2E: `sandbox.spec.ts` → `workspace.spec.ts`, 8 tests:
  - bash shows "Ran …", Files but no Terminal, and the panel survives a reload;
  - bash in the workspace;
  - per-hunk review, now seeded with `api.sandbox.writeFile`;
  - `[tool:write]` → Approve → "Created hello.md" card → Open selects it in the tree and shows it in the editor;
  - typing in the editor → "Saved" → survives a reload (checked through the API too);
  - `@hello` → pick `hello.md` → the reply echoes the file's current content;
  - an attached `.txt` is mentioned in the reply and shows in Files;
  - `/new-file` → dialog → `todo.md` selected and open, the composer empty, the file listed by the API.

  `files.spec.ts`: the composer-attached PDF also shows in Files. `mock-llm.ts`: the echo appends `[<path>: <content>]` for each `<workspace-file>` the server put in the system prompt.
- Visual pass (e2e screenshots, light and dark): tool lines, the error line, the file card, panel with tree selection, the `@` file menu, the Commands menu (no Preview on just-bash), the New file dialog. All fine.

**Checks.** `gate.sh`: install unchanged, check and guards clean, `turbo typecheck lint test build` 82/82. `E2E_PORT=3481 bun turbo test:e2e`: 31/31.

**Left / noticed.**
- After switching the colour scheme at runtime (dark → light), the panel editor's text rendered invisible until the file was reopened (seen in screenshots; not investigated). It looks like the code editor's theme, which is outside this ticket.
- `e2e/README.md` still describes the mock's echo without the mentioned files (not in Owns).
- The composer lists at most what `listFiles` returns (recursive, no cap). A huge workspace means a big `@` list, although `filterMentions` shows 8 at most.

## Resolution (2026-09-30, loop)

Merged in [PR #53](https://github.com/connorwforsyth/openchat/pull/53). Composer ↔ workspace wiring (`@file`, `/new-file`, `/open`, `/preview`, attachments imported), Open buttons, a "Stopped" line, tree re-selection, a fix for editor typing firing shortcuts, and `workspace.spec.ts` (8 tests). e2e 31/31, gate 82/82. Left: the editor text goes invisible after a dark→light switch ([064](064-editor-theme-switch.md)); e2e README; the composer file list isn't capped.
