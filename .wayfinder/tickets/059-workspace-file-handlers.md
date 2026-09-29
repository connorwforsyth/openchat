---
id: "059"
title: "Server side of the workspace file routes"
labels: [wayfinder:build]
status: open
assignee: loop
blockedBy: ["055", "056"]
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

**Owns:** `packages/sandbox/src/handlers/sandbox.ts`, the new `handlers/workspace-files.ts`, `packages/server/src/api/sandbox.ts` and `apps/web/app/api/_lib/sandbox.ts`.

**Changes:**
- **`writeFile` and `importFile`:** `importFile` reads the upload from storage, with the size capped by `uploadMaxMb`. Both check etags.
- **`deleteFile`** runs `rm --` on the resolved path.
- **New `resolveWorkspacePath`** refuses anything outside `/work`: `../`, absolute paths elsewhere, and NUL bytes. Upload names are cleaned.
- **Workspace creation** goes through `ensureWorkspace`.

**Done when:** the handler tests cover path traversal, etag conflicts, a failed workspace recovered by the first write, and viewers being refused, and there are `app.request()` tests for each route.

## Results

Branch `t/059-workspace-file-handlers`, stacked on `t/055-contract-workspace-files` (PR #45) with `origin/main` merged in. Not pushed. Commit `80b7fee`.

- **Handlers** (`packages/sandbox/src/handlers/workspace-files.ts`):
  - `writeWorkspaceFile` takes utf8 or base64. `ifMatch` omitted overwrites. `null` only creates (`already_exists`). An etag replaces only that version: a changed or deleted file is `conflict`/`version_mismatch`. Writing onto a directory is refused. Returns `{ path, size, etag }` (absolute path, SHA-256 of the bytes, the same hash as `readFile`'s router etag). The 5 MiB contract cap is checked again here, because the handler can be called without the contract.
  - `importWorkspaceFile` checks the upload with `getReadableFile` (unreadable is `not_found`, before any workspace starts) and reads it from `Storage`. The read stops as soon as the bytes go over the cap, so a row that under-declares its size is still held to the real bytes. Default path: the cleaned upload name in `/work`. A taken path becomes `name (2).ext` … `(999)`, including an explicit `path`. The write is create-only.
  - `deleteWorkspaceFile` runs `rm -- '<path>'`, or `rm -r --` for a directory. A non-empty directory without `recursive` is `conflict`/`not_empty`. An empty directory needs no flag. A missing path is `invalid`. The path is shell-quoted, so names like `-rf` and `it's.txt` are safe.
  - Each handler checks access, then the path, then calls 056's `ensureWorkspace` with `providerForTurn(deps, "default")`, so there is no duplicate start logic. With no providers the result is `feature_disabled`.
- **Path rules:**
  - `resolveWorkspacePath` gives an absolute path strictly inside `/work`. It refuses `..` that leaves `/work`, absolute paths elsewhere (including `/workspace/…`), `/work` itself, empty or blank paths, NUL and other control characters.
  - `cleanUploadName` strips directories (both slashes) and control characters. It maps `.`, `..` and empty names to `upload`, and caps names at 255 UTF-8 bytes while keeping the extension.
- **Permissions:** `authorize(…, "write")` from `handlers/sandbox.ts`, now exported along with `fromSandboxError`; `get` is untouched. Owners and editors may write, viewers get `forbidden`, others get `not_found`. Refusals happen before a workspace is created.
- **Caps:** just-bash only: 10 MB per file and 50 MB per workspace, counted as the other files plus the new size, so replacing a file doesn't count it twice. Imports are capped at `min(uploadMaxMb, 10 MB)` on just-bash and at `uploadMaxMb` elsewhere. Every cap returns `invalid` → 422, with a message that names the limit.
- **Wiring:**
  - `sandboxApiErrorSchema` gains `{ type: "conflict", reason: "version_mismatch" | "not_empty" }`, mapped to CONFLICT with that reason.
  - `apps/web/app/api/_lib/sandbox.ts` binds all three handlers; `importFile` gets `storage` and `config.limits.uploadMaxMb`.
  - The sandbox package's `workspaceFileErrorSchema` is the handler union plus `conflict`. `SandboxHandlerError` is unchanged, so `turn-tools.ts` `describe` needs no edit.
- **Tests:**
  - `workspace-files.test.ts`: 40 tests on real just-bash and PGlite. Traversal, absolute paths, NUL and control characters, blank paths and the root; create-only, version mismatch, file gone, base64; a failed start recovered by the first write (same id); editors allowed, viewers and strangers refused; import de-dup, explicit path, unreadable upload, missing bytes, `uploadMaxMb`, the 10 MB cap and under-declared size; delete of files, option-like and quoted names, not_empty, recursive, empty directories, missing paths and outside paths. The 50 MB test uses the memory fake, because real just-bash re-saves the whole workspace after each write (about 26 s).
  - `server/src/api/sandbox.test.ts`: `app.request()` tests through `createApp` for each route: 200, 201 and 204 statuses, inputs with defaults (`encoding`, `recursive`, delete path in the body), 409 `already_exists`, `version_mismatch` and `not_empty`, 422, 404, 403 and 401, and a malformed etag refused with 400 before the handler. 18 tests.
- **Gate: 82/82.** The first two runs failed in `@workspace/db#test` and then `@workspace/chat-ui#test` (neither touched here) at load average ~210. Both passed alone, and the third run passed in full.
- **Left:** the version check reads and then writes, so two saves in the same instant can both pass. `getConversationSandbox` still only reads (it doesn't call `ensureWorkspace`).
