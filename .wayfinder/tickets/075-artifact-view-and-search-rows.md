---
id: "075"
title: "Flatten the artifact view; search results show distinguishing names"
labels: [wayfinder:build]
status: open
assignee: loop
blockedBy: ["070"]
---

## Question

Follow-ups from 070 (PR #64):
- The artifact view still stacks 4 header rows (174px) and repeats the file name, in a card. Its rows live in
  `packages/chat-ui/src/artifacts/{artifact-view,artifact-preview}.tsx`, which 070 didn't own.
- File search rows end-truncate identically: 8 results all read "very-long-component…".

## Done when

- **Artifact view.** `ArtifactView` takes a header slot. The title/versions and Preview/Code/Changes rows merge into
  the panel's single 48px header row (with overflow into a "…" menu when narrow). No card or CodeHeader. The border
  census shows at most 1 border between the panel edge and content, like the other views. Before/after screenshots.
- **Search rows.** Each row shows the file name as the primary label (middle-truncated when needed, so the
  distinguishing end stays visible) and the folder path as a muted second line or suffix. Matches are highlighted in
  both. There's a unit test for the truncation and highlight.
- Gate and e2e pass.

## Owns

`packages/chat-ui/src/artifacts/**`, `packages/chat-ui/src/workspace/**` (search rows and the artifact header slot
only), tests, the Lingui catalog.
