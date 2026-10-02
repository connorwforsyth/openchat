---
id: "126"
title: "Documents: a rich-text kind with a full-page editor"
labels: [wayfinder:build]
status: in-progress
assignee: loop
blockedBy: ["124"]
---

## Question

The artifact framework (`docs/proposals/2026-10-01-artifact-framework.md`, PR #76, with Connor's answers in `.wayfinder/QUESTIONS-FOR-CONNOR.md`, "Answered 2026-10-01"). Connor: "artefacts framework keen as well" (2026-10-02). Additive contract routes for the Artifacts page are approved, each in its own PR.

Reference: Claude's document view (title bar with Chat, comments and Share; toolbar with tabs, table, image, checklist and +; serif title; date and author chips).

## Done when

- The `document` kind: ProseMirror JSON (TipTap), with structured model edits (replace a section, insert a block) and whole-replace as a fallback.
- Full-page TipTap editor; a person's edits save a version.
- Export to .md, .pdf and .docx.
- Plan mode's plans become Documents.
- Tests and e2e. Gate passes.

## Owns

`packages/artifacts-kit/src/kinds/document/**`, `packages/chat-ui/**` (editor), e2e.

## Results (2026-10-02, loop)

Built on `t/126-documents`, rebased onto Sites (125). The contract change is its own commit; Connor approved it (2026-10-02).

- **Contract** (`contract:` commit, additive): `document` in `ArtifactKind`; `artifacts.saveVersion` (`POST /artifacts/{id}/versions`, body `{ baseVersionId, content }`, owner or editor, `CONFLICT version_mismatch` on a stale base); optional `editedBy` on `ArtifactVersion`.
- **Kind** (`packages/artifacts-kit/src/kinds/document/`): a version stores TipTap JSON, validated by zod against the editor's own node and mark names. The model reads and writes **Markdown**, converted on the way in (marked's lexer) and out (`modelText`, a new optional part of a kind definition). Edits by heading: `replace_section`, `insert` (section start or end, or the document's end), `delete_section`, with whole replace as the fallback; an operation can say why it can't apply (`problems`). Checks: size (1M chars of JSON), and links and images only to http(s)/mailto/app paths (images https or app). Exports: Markdown, Word (`docx`), and a print page for PDF. Brief instructions for the model.
- **Tools**: `create_artifact` takes `type: "document"` as Markdown; `update_artifact` takes `content` or an `edit` (one flat object: `operation`, `heading`, `position`, `content`), applied to the latest version through the kit (`ArtifactStore.read` is new). Documents' instructions go through Sites' `kinds` prompt layer (125), the one kinds layer; a planning run gets no kind instructions. A chat's own artifact a person edited reaches its model as Markdown, like an attached one.
- **Server and db**: `artifact_version.edited_by`, the kind check gains `document` (migration `20261002060023_documents`, after Sites' `sites`; the kind check holds both `site` and `document`); `saveEditedArtifactVersion` locks the artifact and saves on top of the base version, keeping its chat and message.
- **Editor** (`packages/chat-ui/src/artifacts/document/`): full-page TipTap, in the chat's panel and on `/artifacts/<id>`. Title bar: title, versions, save state, Export, and on the page Chat, Share (a lock while private) and the menu. Toolbar: undo, text style (Text, H1–H3), bold, italic, strike, code, link, bulleted, numbered, checklist, quote, table, image by address, code block, divider. Page: serif title (once, when the document opens with it), date and author chips. Edits save a new version 800 ms after typing stops, with the state always shown (Saved / Edited / Saving… / Couldn't save + Retry / Changed elsewhere + Load theirs or Keep mine); waiting edits are saved on close; viewers and older versions are read only (older ones offer Restore). A document opened from its card follows its latest version.
- **Plan mode**: new plans are Documents; Edit opens the document editor with Approve/Cancel; approving names the latest saved version (or sends Markdown if the person can't save). Markdown plans from before keep approving with the old editor.

Verified: unit tests (kit 56, the document view 8, ai documents 6, server save-version 4 + context 1 + markdown-plan 1, db 2), `bun run check` and `bun run check:guards` on every commit, the gate, and e2e (`documents.spec.ts` 3 tests, `plan-mode.spec.ts` updated, the full suite).

Left: Markdown's label is now "Markdown" (Document is the new kind); Chat goes to the source chat, not a side chat bound to the artifact; no document tabs or comments; images are by address (no upload to the file store yet); dedicated toolbar icons (numbered list, quote, bold) wait on the icons owner, so those use text glyphs.
