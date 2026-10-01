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

## Results (2026-10-02, loop)

Built on `t/124-artifacts-page`, not pushed. Commits: `0aebbdb` (contract, on its own), `a73fe8b` (db and server), `e817109` (chat-ui reads the kit), `361658d` (the pages), `aacf659` (e2e), plus this note.

- **Contract (`0aebbdb`, additive, approved):** new routes in the `artifacts` group:
  - `listAll`: `GET /artifacts`, with `scope` (all, mine or shared), `kind` and `query`, sorted by when you last viewed each item;
  - `detail`: the artifact with its versions;
  - `rename`, `delete`, `duplicate` and `markViewed`;
  - `listGrants`, `share` and `unshare`: `viewer` or `editor` for a user, team or org;
  - `use`: "Use in chat".

  `Artifact` gains `ownerId`, and `ArtifactVersion` gains `conversationId`. Both are new output fields; nothing is removed or narrowed. The row schema is `ArtifactListItem`: `access`, `canGoToChat`, `ownerName`, `viewedAt` and `visibility`. `openapi.json` is regenerated.
- **DB (`a73fe8b`):**
  - `artifact.owner_id`, and `artifact_version.conversation_id`.
  - New tables: `artifact_grant`, `artifact_view` (one row per person) and `artifact_use`.
  - The migration `20261001165524_artifacts_page` was hand-edited to backfill existing rows: the owner is the conversation's owner, and a version's chat is the artifact's chat. A test migrates a database to the step before this one, writes a row the old way, then applies 124.
  - Shares get their own table rather than `resource_grant`. That way they cascade with the artifact, and `packages/auth` and the generic `/grants` routes are left alone.
- **Server:**
  - Who can read an artifact: its owner, anyone holding a share, or anyone who can read a chat that made it or uses it.
  - Deleting and sharing are for the owner only; the owner or an `editor` can rename. `share` refuses yourself, and orgs or teams you're not in.
  - A chat an artifact is used in lists it.
  - The model sees the artifact's latest version, in an instructions section beside `@file` mentions (`api/artifacts-context.ts`).
  - `update_artifact` can make a new version from that chat only when the requester owns the artifact or holds an `editor` share.
- **UI:**
  - **Sidebar:** an "Artifacts" item.
  - **`/artifacts`:**
    - tabs (All, Yours, Shared with you), search, a kind filter, and list or grid;
    - "Make something new" cards: the kit's kinds that show more than their source. Each card starts a chat with a prompt.
    - the list, grouped as Today, Yesterday, Previous 7 days, then by month. Each row has the kind icon, the title, Only you / Shared / Shared by, and Viewed or Updated.
  - **The ⋯ menu:** Use in chat (a new chat or a recent one), Share, Rename, Go to chat (only if you can open that chat), Duplicate, and Delete (owner only).
  - **`/artifacts/<id>`:** the existing artifact viewer with its version history, plus "Open chat" and the same menu. Opening it records Viewed.
  - **Labels and icons:** kind labels are a Lingui map keyed by kind (`model/artifact-kinds.ts`), and the icons come from the kit's `icon` names.
- **Carried over from 123:** chat-ui's extensions, preview kinds and `RUNTIME_IMPORTS` now come from the kit's definitions (`e817109`). This was small.
- **Verified:**
  - `gate.sh`: 88/88 tasks, and `evals --strict: ok`. The first gate run had one failure in `@workspace/chat-ui#test`. chat-ui alone then passed 387/387, and a second gate run passed 88/88.
  - `e2e.sh 3284`: 82 of 82 passed, including the 9 new tests in `artifacts.spec.ts`.
  - Screenshots, light and dark, at desktop and 375 px, were checked by eye.
- **Outside Owns:**
  - `packages/icons`: `LayoutGridIcon`, `ListIcon` and `ShapesIcon`.
  - `packages/server/src/runs/turn.ts`: about ten lines. It's a new optional `attachedArtifacts` dependency, added beside the mentions.
  - `packages/server/src/services.ts`: the store moved to `api/artifacts-context.ts` and is re-exported.
  - In `apps/web`: `proxy.ts`, `lib/routes.ts`, the page shell and the chat route (an `artifactsHref` prop).
  - `connected-chat.tsx`: the same prop.
- **Left for later:**
  - thumbnails for Sites and Presentations (125 and 126);
  - public share links for artifacts;
  - a chip in the chat showing that an artifact is attached (today the chat's Artifacts panel lists it);
  - kind cards that start from a kind's own template rather than a prompt.
- **Open questions:**
  - A duplicate keeps the source's chat and message, so "Go to chat" still works. It also means deleting that chat deletes the copy, because `artifact.conversation_id` still cascades.
  - A new artifact made in a shared chat belongs to the chat's owner, not the person who asked for it.
