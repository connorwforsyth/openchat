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
