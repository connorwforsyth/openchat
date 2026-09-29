---
id: "058"
title: "Tool calls as status lines and file-change cards"
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

**Owns:** in `packages/chat-ui/src/conversation/`: `tool-part.tsx`, `approval.tsx`, `actions.tsx`, and the new `tool-status.tsx` and `file-change-card.tsx`; the new `model/tool-summary.ts`; `ui/components/ai-elements/tool.tsx`.

**Changes:**
- **`toolSummary(call, result)`**, a pure function, gives each tool an icon plus present- and past-tense text, all through Lingui:
  - bash: "Running `cmd`" / "Ran `cmd`";
  - read: "Read `path`";
  - preview: "Opened a preview", with Open;
  - search and MCP tools: "Searched …" / "Used X".
- **Errors** show as a line in the destructive colour.
- **Expanding a line** shows the command and the end of its output (or the raw JSON for other tools).
- **`write`/`edit`** render a card: Created or Edited `path`, +/− counts, and an **Open** button that calls `actions.onOpenFile(path)`.
- **Pending approvals** keep the per-hunk review, including the "Accept change N" labels.

**Done when:** unit tests cover every tool kind, errors and pending approvals.

## Results (2026-09-29, loop)

Built as specified. Commits `5239038` (the feature) and `96a592d` (keeps the runtime `Trans` out of Lingui extraction).

- **`model/tool-summary.ts`**: a pure `toolSummary(call, result)` returns `{ icon, status, label, errorText?, previewUrl?, detail }`.
  - `status` is one of `awaiting | running | done | error | denied`.
  - `label` is a Lingui `msg` descriptor. Its `code` value (a command, a path or a tool name) renders in code font.
  - `detail` is `bash` (the command, plus the last 20 lines of stdout and stderr), `file-change` (the card's data) or `raw` (input and output JSON).
  - Result shapes are parsed loosely with zod, mirroring `packages/sandbox/src/tools/tools.ts`, `web_search` and MCP's `isError`. An unknown shape still gets a line.

  | Tool | Running / done | Error | Other |
  |---|---|---|---|
  | bash | Running `cmd` / Ran `cmd` (first line, cut to 60 chars) | Couldn't run `cmd`; a non-zero exit gives "`cmd` exited with code N" or "`cmd` timed out", with the last stderr line as the reason | |
  | read | Reading / Read `path` | Couldn't read `path` | |
  | write, edit | Writing / Editing `path`, then the card | Couldn't change `path` | "No changes to `path`"; every hunk rejected gives "Didn't change `path`" |
  | preview | Opening / Opened a preview, with Open (a link to the URL, new tab) | Couldn't open a preview | |
  | file_search | Searching / Searched your files | Couldn't search your files | |
  | web_search | Searching / Searched the web | Couldn't search the web (also when the search is `unavailable`) | |
  | MCP `server__tool` | Using / Used `tool` from server | Couldn't use … (also `isError`) | |
  | anything else | Using / Used `name` | Couldn't use `name` | |

  Every tool also has "Wants to …" (pending approval) and "Didn't …" (denied) labels.
- **`conversation/tool-status.tsx`**: a muted line showing the icon and label.
  - Failures are drawn in the destructive colour, with the reason inline.
  - While a tool runs, a spinner turns (with reduced motion it pulses opacity instead; D28).
  - The line is a Collapsible, closed by default and opening instantly. It shows the command and the end of its output for bash, and `ToolInput`/`ToolOutput` JSON for everything else.
- **`conversation/file-change-card.tsx`**: shows Created or Edited, the path, and +/− counts.
  - Counts come from the patch's hunk bodies only, so the `---` hash header doesn't count; `@@ -0,0` means the file was created.
  - Only applied hunks are counted, and "N changes rejected" is shown when some were.
  - An **Open** button calls `actions.onOpenFile(path)`; it's hidden when that action is absent.
- **`actions.tsx`**: adds the optional `onOpenFile?: (path: string) => void`. **`tool-part.tsx`** picks the card or the line, and keeps `ApprovalCard` (per-hunk review) while approval is pending.
- `approval.tsx` and `ai-elements/tool.tsx` are unchanged. The line reuses `ToolInput`/`ToolOutput` with `p-0`, so the dev demo still works. `messages.po` was re-extracted.

### Verification

- **Unit tests:** `tool-summary.test.ts` (pure) and `tool-part.test.tsx` (browser mode) cover every tool kind, errors, the file-change counts, Open with and without `onOpenFile`, the preview link, MCP and raw expansion, and pending approval with Accept/Reject change N → Submit review. chat-ui: 131/131.
- **Gate:** `gate.sh` is clean, `turbo typecheck lint test build` 82/82.
- **E2E:** `E2E_PORT=3158 bun turbo test:e2e` 25/25. No spec needed a change.
