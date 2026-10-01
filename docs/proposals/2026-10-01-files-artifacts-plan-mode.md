# Proposal: files first, purpose-built artifacts, and a plan mode

_Status (2026-10-01): a proposal for Connor. Nothing here is built. It needs his decisions on the questions at the end._

## Why

Connor, trying the app on 2026-10-01:

- He made an artifact and liked the card in the chat: a rendered preview is nicer than opening a file.
- But an artifact is "basically just creating a markdown file", and having both Artifacts and Files in the Workspace panel is confusing. "If the label of artefacts was just files, that would be cleaner."
- Claude keeps artifacts for purpose-built kinds (documents, presentations, spreadsheets). For a non-trivial document, a purpose-built artifact tool could be useful.
- He'd like a plan mode.

## What exists today

**Artifacts** are database rows, not files.

- **Storage:** `artifact` and `artifact_version` in `packages/db/src/schema/files.ts`.
- **Kinds:** html, react, svg, mermaid, markdown and code.
- **Writing:** only the model writes them, through `create_artifact` / `update_artifact`. Those tools arrive with S0, in draft PR #69. Each update stores a whole new version.
- **Display:** the Workspace panel shows an artifact with Preview, Code and Changes tabs and version arrows. HTML, React and SVG render on the separate artifacts origin (D24).
- **Editing:** no user can edit one. There is no editor and no write route.

**Workspace files** live in the chat's sandbox at `/work` (D7).

- **Editing:** people edit them in the panel's editor, which saves as you go. The agent's changes to them are reviewed hunk by hunk.
- **Preview:** HTML and Markdown files have a Preview/Code toggle, and the built-in browser previews pages and servers.

**The overlap:** a page or a Markdown note can be made either way. Nothing connects the two, so the model can produce two unrelated copies.

## Recommendation

### 1. Files are the one place things live

- **One way to make things:** the model writes Markdown, HTML, code and data as workspace files. `create_artifact` comes out of PR #69 before it merges.
- **The card stays:** writing or changing a file shows the same card the artifact did. It renders Markdown and previews HTML, with the change and an Open button. This keeps what Connor liked and drops the second concept.
- **Panel label:** the panel says Files. The Artifacts section goes.
- **Markdown editor:** `.md` files open in a rich editor, using TipTap, which the composer already uses. A Code toggle shows the raw text, and saving works as it does today.

### 2. Artifacts come back as purpose-built kinds, later

As Claude does, an artifact means a deliverable with its own editor and export. It is not a container for any text.

- **Document:** rich text with headings, tables, images and comments. Exports to .docx, .pdf and .md.
- **Presentation:** slides, exporting to .pptx and .pdf.
- **Spreadsheet:** a grid with formulas, exporting to .xlsx and .csv.

Each kind is versioned (the existing tables fit), has an editor for people, and has tools for the model that edit structure rather than rewrite whole text. They are shared and annotated through D16's loop.

**Order:** start with Document, because it's the one Connor described. Presentations and spreadsheets follow only if Documents prove useful.

### 3. Plan mode

This works like Claude Code's plan mode, built from what we already have.

- **Turning it on:** *Plan* is a switch in the composer's + menu, next to Web search.
- **During planning:** the run can only read and search: `read`, `file_search`, `web_search`, `bash` limited to read-only commands, and MCP read tools. It writes its plan to `/work/PLAN.md`, and the chat shows the plan card with **Approve** and **Edit**.
- **Editing:** Edit opens the plan in the Markdown editor from part 1.
- **Approving:** starts a normal run, with the plan as context. Changes then go through the usual approvals.
- **Server enforcement:** the read-only tool set in plan mode is enforced on the server, not only hidden in the client. It is a preset of the permissions proposal (073): everything that writes is `deny` while planning.

## What it needs

| Part | Contract change | Size | Depends on |
|---|---|---|---|
| Drop `create_artifact` from #69; panel says Files | none | small | #69 |
| A card for file writes (rendered preview) | none (it reuses tool parts) | small–medium | — |
| Markdown rich editor | none | medium | — |
| Plan mode | yes: a run option `mode: "plan"` | medium | 073's rule evaluator, or a narrow built-in preset |
| Document artifacts | yes: an artifact kind and its edit operations | large | the parts above |

## Questions for Connor

1. **Files first:** agree to drop `create_artifact` from #69 and show the file card instead?
2. **Document artifacts:** worth starting after the parts above, or wait until you've lived with files for a while?
3. **Plan mode contract:** OK to add `mode: "plan"` as an optional run option (additive)?
4. **Plan mode's dependency:** wait for the permissions proposal (073) to decide its rule engine first, or ship a narrow built-in read-only preset now and fold it into 073 later?
5. **Plan file location:** `/work/PLAN.md`, a single plan per chat that is overwritten, or `/work/plans/<n>.md` to keep history?
