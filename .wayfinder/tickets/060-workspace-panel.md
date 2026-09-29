---
id: "060"
title: "One Workspace panel"
labels: [wayfinder:build]
status: closed
assignee:
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

## Results

Built on `t/060-workspace-panel` (stacked on 055's contract branch with `origin/main` merged). Not pushed; `status` stays `open`. Until 059 lands, the server answers `FEATURE_DISABLED` for `writeFile`/`importFile`/`deleteFile`, so saving, New file, drops and deletes show "The workspace isn't available on this server right now." in the running app; the panel, tests and demos exercise them over fakes and an in-browser just-bash workspace.

**Panel** (`packages/chat-ui/src/workspace/`, renamed from `sandbox/`).
- `WorkspacePanel` is a `<section aria-label="Workspace">`: a list beside a main area (container query: side by side from 32rem, stacked below). `RightPanel` is now just a "Workspace" title bar with Close; no tabs.
- The list has **Preview · :port** (only when `sandbox.previews` has one), **Files** (the `@pierre/trees` `FileTree`, a New file button and a "…" menu with Upload files…, Refresh and Reset workspace…) and **Artifacts** (database rows, D24).
- Selection is `WorkspaceSelection` (`model/workspace.ts`): `file | artifact | preview`. The layout remembers the section (`files | artifacts`); `shownSelection` shows the host's selection when it belongs to the open section, else the section's default (newest artifact; the preview if any).
- `artifacts/artifacts-panel.tsx` became `artifact-view.tsx` (`ArtifactView`: one artifact's preview/code/changes and versions); `lazy-artifacts-panel.tsx` is gone; `LazyWorkspacePanel` lazy-loads the whole panel (D27).
- Preview: an iframe with Reload and Open in a new tab; no port box. Before showing the page it probes the URL from a hidden opaque-origin `srcdoc` frame (the runner's proxy only lets origin "null" read responses, and its error has no CORS headers); if nothing answers: "Nothing is running on port {port} yet. Ask the agent to start the app." with Retry (loop request).

**Editor.** `packages/code-ui/src/code-editor.tsx` (`@workspace/code-ui/code-editor`): `@pierre/diffs` `File` with `edit`, `EditProvider` and `Editor` from `@pierre/diffs/edit`; `onChange(text)`, `onSave` on ⌘S / Ctrl+S (captured before the editor), `readOnly`. The open file is a pure state machine (`workspace/model/editor.ts`, `openFileReducer`) driven by `use-open-file.ts`: saves 800 ms after typing stops or on ⌘S, with `ifMatch` = the `readFile` etag, then the returned etag; `version_mismatch` shows "Changed by the agent" with **Reload** (reads the agent's version) and **Overwrite** (writes without `ifMatch`). Binary files show a note; files over 1 MB open read-only. Markdown is edited as source. Switching files flushes a pending save. Delete asks first (`deleteFile`).

**States.** Empty: "No files yet. Ask for one, drop a file here, or type /new-file" with New file (dialog → `writeFile` with `ifMatch: null`; a taken name is refused in the dialog) and a drop zone over the whole panel (upload → `importFile`, via the port's `importFile(file)`). A new chat with no id shows "No files yet. Files you and the agent create will appear here." with New file disabled; "Sandboxes are turned off on this server." only when `features.sandboxes` is false (loop request; `WorkspaceFilesSource` = `off | new-chat | chat`). Failed: an inline alert with the message, "It starts again the next time you or the agent use a file." and Retry (refetches `sandbox.get` and relists; 056's `ensureWorkspace` heals on the next use); Reset is in the "…" menu behind a confirmation. Provisioning: "Starting the workspace…".

**One source of truth.** `use-sandbox-panel.ts` and its "adopt initial" hack are deleted. The panel reads the `sandbox.get` record it's given (`files.sandbox`); every action calls `files.onChanged`, which `ConnectedChat` maps to invalidating `api.sandbox.key()`. `workspaceRevision(messages)` counts settled `bash/read/write/edit/preview` results; when it moves the panel relists, reloads the open file unless it has unsaved edits, and refetches the record.

**Removed from the UI:** the Terminal (`terminal.tsx`, `model/log.ts`), the port box, the status/isolation pill, "Create sandbox". `exec` stays in the API.

**Layout and shortcuts.** Stored `"sandbox"` → the panel on its files; `"artifacts"` stays the panel on its artifacts. Default width 560 px. S toggles the files, A the artifacts (ids unchanged). Labels: "Show or hide the workspace" / "Show the workspace artifacts" (`packages/shortcuts`), "Workspace" / "Workspace artifacts" (chat-ui's own labels). Palette: `PaletteContext.workspace`, "Show/Hide the workspace" (keywords files, artifacts, preview).

**Opening from the chat.** `ChatScreen` wires `actions.onOpenFile(path)` (the file-change card's Open) to open the file in the panel (paths normalised by `workspacePath`: `/work/a.md`, `./a.md`, `a.md`), and takes `workspaceHandle?: Ref<WorkspaceHandle>` exposing `openFile(path)` and `openPreview()` for 062's composer commands.

**App.** `_shared/sandbox-client.ts` implements `WorkspaceClient` (CONFLICT reasons as values; import = `files.upload` then `sandbox.importFile`). `chat-route.tsx`: palette `workspace` toggle. `dev/sandbox/demo.tsx`: the panel over a just-bash workspace in the tab with etags, conflicts (an "Edit README.md as the agent" button) and a preview nothing answers; `dev/chat/demo.tsx` uses the same workspace.

**Outside Owns, minimal:** `packages/chat-ui/package.json` exports (`./workspace/*`), `vitest.config.ts` (pre-bundle `@pierre/diffs/edit`), `chat-ui/src/shortcuts/use-shortcut-labels.ts` (labels), palette and shortcuts tests (strings), `e2e/support/chat.ts` (`openWorkspace` returns the region), `e2e/tests/sandbox.spec.ts` (the terminal test now seeds `a.txt` with `[tool:bash …]` and checks the tree, no Terminal, and the reload; per-hunk review unchanged), the catalog.

**Tests.** chat-ui 165/165: `workspace-panel.test.tsx` (list and selection, no terminal, the artifact view, save after the pause with the etag then the new one, ⌘S, conflict with Overwrite and with Reload, delete with confirmation, empty + New file, taken name, new chat, off, failed with Retry and Reset, revision reload and leaving unsaved edits alone, the preview's not-running message and Retry), `model/editor.test.ts`, `model/workspace.test.ts`, layout migration in `layout.test.ts` and `chat-screen.test.tsx` (stored `"artifacts"`, S on a new chat, `openFile` through the handle, no Terminal in the narrow sheet). `use-sandbox-panel.test.ts` and `log.test.ts` are gone.

**Checks.** `gate.sh`: 82/82. E2E (`E2E_PORT=3461`): 26/26; the first run had one `memory.spec` failure ("nothing is saved from a shared chat", a run error on the server side) that passed on the rerun. Screenshots of `/dev/sandbox` and `/dev/chat` (editor, conflict, preview not running, menu, files, artifacts light/dark, narrow sheet).

**For 062.**
- Composer commands: `ChatScreen`'s `workspaceHandle` (`openFile`, `openPreview`); `/new-file` can reuse `NewFileDialog` or call `writeFile` with `ifMatch: null` then `openFile`.
- `onOpenPreview` for the preview status line: call `workspaceHandle.openPreview()` (or `select({kind:"preview"})` in `ChatScreen`).
- `workspace.spec.ts` can drive the editor by clicking `[data-slot="code-editor"] [contenteditable="true"]` (Playwright pierces the shadow root) and waiting for "Saved".
- Selecting the same file in the tree after viewing an artifact doesn't re-fire the tree's selection (the tree still has it selected); click another item first, or remount the tree if it matters.

## Resolution (2026-09-30, loop)

Merged in [PR #52](https://github.com/connorwforsyth/openchat/pull/52). One Workspace panel (Preview, Files with editor, Artifacts), no terminal, etag-safe editing, one source of truth, new-chat and preview-not-running states. chat-ui 165/165, e2e 26/26, gate 82/82.
