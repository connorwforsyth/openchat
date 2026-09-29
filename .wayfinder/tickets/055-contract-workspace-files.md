---
id: "055"
title: "Contract: workspace file routes"
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

**Owns:** `packages/contract/**`. It only adds things, in `schemas/sandbox.ts` and `routes/ops.ts`:
- **`sandbox.writeFile`**, `POST /conversations/{id}/sandbox/files`:
  - input `{conversationId, path, content, encoding: utf8|base64, ifMatch?: etag|null}`, output `{path, size, etag}`;
  - `ifMatch: null` means create only (CONFLICT `already_exists`); an etag means CONFLICT `version_mismatch` if the file changed;
  - capped at about 5 MB of data.
- **`sandbox.importFile`**, `POST /conversations/{id}/sandbox/imports`: `{conversationId, fileId, path?}` copies an uploaded file into the workspace, and de-duplicates the name.
- **`sandbox.deleteFile`**, `DELETE /conversations/{id}/sandbox/files`: `{conversationId, path}`.
- **`readFile`** also returns an `etag`, a sha-256 of the file.

Each new route creates the workspace on first use. `get` stays read-only. `exec`, `exposePort`, `create`, `reset` and `destroy` stay, for the agent, the API and tests. `runOptionsSchema.sandbox` stays, with its documentation changed so that `auto` means file tools are always on.

**Done when:** the routes have tests, the OpenAPI output includes them, the PR touches nothing else, and there's a line in QUESTIONS-FOR-CONNOR.

This PR changes `packages/contract`: the loop never merges it; Connor does.

## Results

Branch `t/055-contract-workspace-files`, commit `cd0c30f` (touches only `packages/contract/**`). Not pushed; Connor reviews and merges.

- **Schemas** (`schemas/sandbox.ts`): `sandboxFileEncodingSchema` (`utf8 | base64`), `sandboxFileEtagSchema` (lowercase hex SHA-256), `SANDBOX_WRITE_MAX_BYTES` (5 MiB decoded, checked per encoding; over it is `BAD_REQUEST`), `writeFileInputSchema`, `sandboxFileWriteSchema` (`{ path, size, etag }`), `importFileInputSchema`, `deleteFileInputSchema`.
- **Routes** (`routes/ops.ts`, `sandbox` group): `writeFile` `POST /conversations/{conversationId}/sandbox/files` (CONFLICT `already_exists` / `version_mismatch`, FEATURE_DISABLED); `importFile` `POST /conversations/{conversationId}/sandbox/imports` → 201 (FEATURE_DISABLED; a taken path gets a free name, never a conflict); `deleteFile` `DELETE /conversations/{conversationId}/sandbox/files` → 204, with an added `recursive` flag (default `false`; a non-empty directory without it is CONFLICT `not_empty`). `readFile` output gains `etag`. `exec` is described as for the API and tests. `runOptionsSchema.sandbox` now documents `auto` as file tools whenever sandboxes are enabled.
- **Tests**: round-trip cases for every new schema, cap tests (decoded base64, UTF-8 bytes rather than characters), and contract tests for the paths, errors, the readFile etag and the OpenAPI operations. Contract: 1346 pass. `openapi.json` regenerated; Redocly lint passes. README has a "Changes (2026-09-29, 055)" table.
- **Gate: fails, as expected, on `@workspace/server` typecheck** (and `web` typecheck/build, which depend on it). All three errors are in `packages/server`: `src/api/sandbox.ts:160` (`implement(contract)` needs handlers for `writeFile`, `importFile` and `deleteFile`), `:180` (`SandboxApi.readFile` returns no `etag`), and `src/server.ts:460` (follows from the first). Lint, check, guards and every test suite pass. This contract PR has to land together with the server stubs or implementation from 059.
