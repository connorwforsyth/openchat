# Proposal: artifacts as deliverables, files as working material, and a plan mode

_Status (2026-10-01): a proposal for Connor. Nothing here is built; it needs his decisions on the questions at the end. Revised the same day after he said to keep artifacts._

## Why

Connor, trying the app on 2026-10-01:

- He made an artifact and liked it: the card in the chat and the rendered preview.
- Having both Artifacts and Files in the Workspace panel is a little confusing, because a Markdown artifact is "basically just creating a markdown file".
- Then: "I actually don't mind the artefacts feature … sites, presentations, spreadsheets etc. — these are all things that we may want to do — and a user might want to filter by their artefacts."
- He'd also like a plan mode.

So artifacts stay and grow. The work is to make the line between artifacts and files obvious, and to give artifacts a home of their own.

## What exists today

**Artifacts** are database rows (`artifact`, `artifact_version` in `packages/db/src/schema/files.ts`).

- **Kinds:** html, react, svg, mermaid, markdown, code.
- **Writing:** only the model can create or change one, through `create_artifact` / `update_artifact`, which come with S0 in draft PR #69. Each update stores a whole new version.
- **Viewing:** the panel shows an artifact with Preview, Code and Changes tabs and version arrows. Rendering happens on the separate artifacts origin (D24).
- **Editing:** people can't edit one.
- **The API:** it can list artifacts per conversation only (`/conversations/{id}/artifacts`). Nothing lists them across chats.

**Workspace files** live in the chat's sandbox at `/work` (D7).

- **Editing:** people edit them in the panel. The agent's changes are reviewed hunk by hunk.
- **Previewing:** the built-in browser shows pages and dev servers.

## The line between them

| | **Artifact** | **File** |
|---|---|---|
| What it is | A deliverable: something you'd keep, share or come back to | Working material: what the agent builds and runs |
| Where it lives | The database, versioned, visible across chats | The chat's workspace (`/work`) |
| Who makes it | The model on request, or you with "Save as artifact" | The agent's tools, or you in the editor |
| Examples | A site, a presentation, a spreadsheet, a document, a diagram | Source code, configs, data, scratch notes, a dev server |

**Rule of thumb for the model, put in the artifacts prompt fragment:**
- Make an artifact when the person asks for a thing to keep (a site, slides, a sheet, a doc, a diagram).
- Use files when it's building or running something in the workspace.
- Never make both for the same thing.

A site built across many files with a dev server stays files. **Save as artifact** snapshots it into one artifact: a bundled static build where that's possible, otherwise its entry page.

## Recommendation

### 1. An Artifacts library

- **A new Library tab or page, Artifacts:** every artifact you can see, across chats. Each one shows its kind, title, the chat it came from and when it was updated.
- **Filtering and search:** filter by kind (Sites, Presentations, Spreadsheets, Documents, Diagrams, Code), by chat and by owner, and search by title.
- **Opening one:** it opens full-page, with its version history and a link back to the chat.
- **Sharing:** uses the existing sharing model (conversation access), with public links later under `features.publicLinks`.
- **Needs:** a list route across conversations (contract, additive).

### 2. Purpose-built kinds, each with its own viewer, editor and export

| Kind | Viewer | Person edits with | Model edits with | Export |
|---|---|---|---|---|
| **Site** (html / react today) | the runtime origin | code, or Annotate (D16) | `update_artifact` | .html / .zip |
| **Document** (markdown today) | rendered prose | TipTap rich editor, which saves a new version | `update_artifact` | .md, .pdf, .docx |
| **Presentation** (new) | a slide viewer, presenting full-screen | slide outline and text | structured slide edits | .pptx, .pdf |
| **Spreadsheet** (new) | a grid with formulas | cells | structured cell and range edits | .xlsx, .csv |
| Diagram (svg / mermaid today) | the runtime | source | `update_artifact` | .svg, .png |

- **New kinds use structured data.** A presentation is JSON slides and a spreadsheet is JSON cells, not text the model rewrites whole. That makes edits small and reviewable, and lets the Changes tab show a slide or cell diff.
- **Order:** Documents first (an editor on a kind we already have), then Presentations, then Spreadsheets.

### 3. Clearer in the Workspace panel

- **Panel layout:** the panel keeps both, under two plain headings, **Artifacts** (this chat's) and **Files**. With 097, the browser sits on top and files sit below.
- **Cards in the chat:** an artifact card says what it is ("Presentation · 12 slides"). A file the agent writes gets a smaller file card.
- **Markdown files:** they get the same TipTap editor as Document artifacts, plus a "Save as artifact" action.

### 4. Plan mode

This works like Claude Code's plan mode.

- **Turning it on:** a **Plan** switch in the composer's + menu, next to Web search.
- **While planning:**
  - The run can only read and search: `read`, `file_search`, `web_search`, read-only `bash`, and MCP read tools. The server enforces this; it is not just hidden in the client.
  - It writes its plan as a **Document artifact**, so the plan appears in the library too. The chat shows it with **Approve** and **Edit**.
- **Edit** opens the plan in the document editor.
- **Approve** starts a normal run with the plan as context, and changes then go through the usual approvals.
- **Relation to the permissions proposal (073):** plan mode is a preset of it, where everything that writes is `deny` while planning.

## What it needs

| Part | Contract change | Size |
|---|---|---|
| Model guidance (artifact vs file) and clearer cards | none | small |
| Artifacts library (list across chats, filters) | yes: one list route | medium |
| Document editor (TipTap, saves a version) | yes: a route for a person to save a version | medium |
| Save a workspace file or site as an artifact | yes: one route | medium |
| Plan mode | yes: an optional run option `mode: "plan"` | medium |
| Presentation kind | yes: kind plus structured content | large |
| Spreadsheet kind | yes: kind plus structured content | large |

All contract changes here are additive.

## Questions for Connor

1. **The line:** does the artifact-vs-file table match how you think of it?
2. **Order:** library and Documents first, then plan mode, then Presentations, then Spreadsheets? Or plan mode first?
3. **Where the library lives:** in the Library page as a new Artifacts tab next to agents and prompts, or a top-level item in the sidebar?
4. **Contract:** OK to add the additive routes and fields above as each part is built? Each one would still be its own PR for you to review.
5. **Plan mode:** wait for the permissions proposal (073) to settle its rule engine, or ship a narrow read-only preset now and fold it in later?
