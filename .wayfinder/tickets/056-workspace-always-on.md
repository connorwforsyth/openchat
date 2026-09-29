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

## Results

Built on `t/056-workspace-always-on`, not yet pushed.

- **Tools always offered.** `chatSandboxTools` (`packages/server/src/runs/turn.ts`) asks for the `default` provider on every plain chat, unless `options.sandbox === "off"`. When the chat has tools, `modelTurn` adds `WORKSPACE_INSTRUCTIONS` (`server/runs/sandbox.ts`): the workspace is `/work`, it shows in the Files panel, and the model must never ask the user to run commands.
- **`ensureWorkspace`** lives in `packages/sandbox/src/handlers/turn-tools.ts`, so `handlers/sandbox.ts` is untouched. It builds on the exported `createConversationSandbox` and `resetSandbox`:
  - no row → create one;
  - `failed` or `destroyed` → restart in place (same id and provider);
  - `stopped` or `ready` → attach. A just-bash workspace the process lost is restarted.
  - `provisioning` → attach only.

  `lazySandbox` forgets a failed start, or a sandbox destroyed under it, so the next call in the same turn tries again.
- **Docker fallback.** A new workspace probes the wanted provider's `isolation()`. If it fails, the workspace uses `FALLBACK` (just-bash). An existing workspace keeps its provider: through a runner outage the row stays `ready` and nothing is reset.
- **Tool names are unchanged.** Descriptions and error text now say "workspace", `/work` and the Files panel. `destroyed` no longer tells the model to ask the user to create a sandbox.
- **Stale-edit guard.** A `write`/`edit` proposal stamps the SHA-256 of its base file into the patch's `---` header, the unified-diff timestamp slot. The contract has no field for it, and `normalisePatch` drops everything before the first `@@`, so the review UI is unaffected. On resume after approval, a hash mismatch returns an error telling the model to read the file again. The existing patch comparison stays as a backstop.
- **`@file` mentions.**
  - `packages/ai/src/messages/workspace-file.ts` has `WORKSPACE_FILE_DATA`, `workspaceFileRefSchema` and `workspaceFileRefs`.
  - `run-transport.ts` `userParts` keeps valid `data-workspace-file` parts.
  - `server/runs/workspace-context.ts` resolves them: files up to 32 KB are inlined as `<workspace-file path=…>`, with 128 KB per message in total. Larger files get a note to use `read`; missing, binary or unreadable files get a note. It never fails the turn.
  - The executor (not owned here) passes stored messages through `convertToModelMessages`, which drops data parts. So the resolved text goes into the turn's **instructions**, only for the message the run answers. It is re-read on every pass, so the model sees current contents.
- **Outside Owns, needed for the above:** a `./messages/workspace-file` export in `packages/ai/package.json`, `@workspace/ai` as a dependency of `packages/client`, and the matching `bun.lock` line.
- **PLAN.md D7** now describes the always-on workspace.

**Tests:**
- `turn-tools.test.ts`:
  - a plain chat gets the tools and its first call creates the workspace;
  - `off` means no tools;
  - mentions reach the prompt;
  - a start that fails and then succeeds recovers without a Reset;
  - a lost just-bash workspace restarts;
  - Docker down means a new workspace is just-bash;
  - an existing Docker workspace keeps its id, provider and files through an outage.
- `tools.test.ts`: the hash stamp still parses in code-ui, and an approved edit is refused after a user edit outside the hunk's context.
- `workspace-context.test.ts`, `workspace-file.test.ts`, and a `run-transport.test.ts` case.

**Checks:**
- Gate: 82/82. Earlier runs timed out in `db` and `auth` tests under load average ~150; both pass alone.
- E2E: the sandbox spec passes (4/4 with setup), and the full suite passes (25/25).

**Left for later:**
- 059: `getConversationSandbox`/panel reads could use `ensureWorkspace`. A row stuck in `provisioning` after a crash still only attaches.
- 062 (composer): send `data-workspace-file` parts next to the `@path` text.
- The model's `tools` capability isn't consulted before offering sandbox tools. `TurnResolverDeps.config` has no `providers`, and `file_search` works the same way today.
