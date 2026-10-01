---
id: "124"
title: "The Artifacts page: a sidebar item, list, filters, use in chat, share"
labels: [wayfinder:build]
status: in-progress
assignee: loop
blockedBy: ["123"]
---

## Question

The artifact framework (`docs/proposals/2026-10-01-artifact-framework.md`, PR #76, with Connor's answers in `.wayfinder/QUESTIONS-FOR-CONNOR.md`, "Answered 2026-10-01"). Connor: "artefacts framework keen as well" (2026-10-02). Additive contract routes for the Artifacts page are approved, each in its own PR.

Design: the "Artifacts page" section of the framework doc (after Claude's Artifacts and ChatGPT's Sites references): tabs All / Yours / Shared with you; Make something new cards; a list grouped by date with kind icon, title, visibility and "Viewed …"; grid view; ⋯ menu with Use in chat, Share, Rename, Go to chat, Duplicate, Delete. No "Made in" label; "Open chat" lives in the artifact's own view.

## Done when

- **Contract (additive, approved, own PR):** list artifacts across chats with filters; get with versions; rename; delete; share (owner and grants, like library items); a per-person last-viewed record.
- **DB:** an artifact gets an owner and grants; versions record the chat that made them. Migrate existing rows (owner = conversation owner).
- **UI:**
  - an Artifacts sidebar item and page;
  - a full-page artifact view at `/artifacts/<id>` with version history and an "Open chat" action, shown only to people who can open that chat;
  - "Use in chat" attaches the artifact by reference, so the model sees and can version the same artifact from another chat.
- e2e covers list, filter, open, share and use in chat. Gate passes.

## Owns

`packages/contract/**` (these routes), `packages/db/**` (artifact owner/grants, views), `packages/server/src/api/artifacts*`, `packages/chat-ui/**` (page, view), `apps/web/app/(app)/(pages)/artifacts/**`, e2e.

## Carried over from 123 (PR #90)

- Kind labels in `packages/artifacts-kit` are plain English; this page needs them translated (e.g. a Lingui map in chat-ui keyed by kind).
- chat-ui still has its own copies of per-kind data (extensions, preview kinds, `RUNTIME_IMPORTS`); move it onto the kit's definitions here.
