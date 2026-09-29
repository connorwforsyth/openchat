---
id: "061"
title: "Composer file features (composer package only)"
labels: [wayfinder:build]
status: closed
assignee:
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

**Owns:** in `packages/composer/src/`: `schemas.ts`, `mentions.ts`, `triggers.ts`, `doc.ts`, `value.ts`, `props.ts`, `options.ts`, `editor/extensions.ts`, `hooks/use-suggestion-menus.ts` and `components/{suggestion-menu,composer,composer-loader}.tsx`.

**Changes:**
- A `file` kind for mention candidates and tokens.
- New props `files`, `commands` and `onCommand`.
- The `/` menu lists `/new-file`, `/open` (which opens a file list) and `/preview` before prompts.

**Done when:** browser tests cover choosing a file mention, the `{kind:"file", path}` token it produces, and each command.

## Results (2026-09-29, loop)

The composer now knows about workspace files, still with no knowledge of the app: the host passes
paths and command names in, and gets tokens and `onCommand` calls out.

- **Types (`schemas.ts`).** `workspacePathSchema` (`z.string().min(1)`, workspace-relative),
  `composerCommandSchema = z.enum(["new-file", "open", "preview"])`, and a third
  `mentionCandidateSchema` kind: `{ kind: "file", path, label, description? }` (label is the file
  name, description its folder). `mentionTokenSchema` gains the matching
  `{ kind: "file", path, label, start, end }`; `text.slice(start, end)` is `@label` as for the others.
  In the editor a file mention is the same Mention node with the path in its `id` attribute;
  `doc.ts` turns that back into `path`.
- **Props (`props.ts`).** `files?: readonly WorkspacePath[]`, `commands?: readonly ComposerCommand[]`,
  `onCommand?: (command: ComposerCommand, path?: WorkspacePath) => void`. The shell ignores them, and
  the loader passes them through unchanged.
- **`@` menu.** Files come after agents and people (`mentionCandidates(agents, people, files)`), with
  a file icon, the name, and the folder as the hint. `filterMentions` ranks files separately (by name
  or path, 8 at most) so a big workspace never pushes people out of the list.
- **`/` menu (`options.ts` `slashItems`, `triggers.ts` `slashStage`).** The host's commands come
  first, always in the order new-file, open, preview, and only those listed in `commands`. Prompts
  follow as before. The title reads "Commands" when a command is listed and "Prompts" otherwise.
  Choosing `/new-file` or `/preview` deletes the `/query` text and calls `onCommand(command)`.
  Choosing `/open` rewrites the trigger to `/open:`. The same Suggestion keeps running and lists
  `files` under "Files"; typing filters them, and Backspace past the colon goes back to the commands.
  Choosing a file deletes the text and calls `onCommand("open", path)`. With no `files`, `/open` calls
  `onCommand("open")` straight away. A typed file name after `/new-file` isn't supported:
  single-word triggers can't hold a space.
- **Icons:** `FileIcon`, `PlusIcon` (new file) and `EyeIcon` (preview), all already in the registry.
  **Strings:** "Commands", "Files", "New file", "Open file" and "Preview", with the catalog
  re-extracted. `packages/i18n/locales/en/messages.po` is outside Owns, but the Lingui guard requires
  it to match the source (+14 lines).

| Check | Result |
|---|---|
| New browser tests in `components/composer.test.tsx` | Choosing a file mention gives `{ kind: "file", path: "src/app.ts", label: "app.ts", start: 4, end: 11 }` in the submitted value. `/op` then Enter lists 2 files; typing `read` narrows to 1; Enter calls `onCommand("open", "README.md")` and clears the text. `/new-file`, `/preview`, and `/open` with no files call `onCommand` and never submit. Commands are hidden without `commands`, and only `preview` shows when that's the only one passed |
| New pure tests | `fileCandidate`/`candidateKey`, `filterMentions` with files, `slashItems` (order, hiding, `open:` stage), `slashStage`, and `serializeDoc` for a file node |
| composer suite | 79/79 (3 runs) |
| Gate (`.tools/gate.sh`) | `bun install --frozen-lockfile` no changes; `check` and `check:guards` clean; `bun turbo typecheck lint test build` 82/82. (The Lingui guard counts any uncommitted `.po` change as drift, so the gate only passes once the catalog is committed.) |

Notes for 062 (wiring):
- Pass the workspace's file paths as `files` (workspace-relative, no leading `/`), and
  `commands={["new-file", "open", "preview"]}` or whichever of these the app can do.
  `onCommand(command, path?)` receives `"open"` with a path, or without one when `files` is empty.
- A file mention reaches `onSubmit` as `value.mentions[i] = { kind: "file", path, label, start, end }`.
  The text reads `@app.ts`, so the host should add the path to the message itself, for example as a
  `data` part, if the model needs it.
- `packages/composer/README.md` isn't in Owns, so it doesn't list the new props yet.

## Resolution (2026-09-29, loop)

Merged in [PR #48](https://github.com/connorwforsyth/openchat/pull/48). Composer `files`/`commands`/`onCommand`, `@` file mentions (`{kind:"file", path}`), and the `/new-file`, `/open` (file list) and `/preview` commands. Composer 79/79, gate 82/82.
