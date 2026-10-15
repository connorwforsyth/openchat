---
id: "161"
title: "Kinds bring their starter card and thumbnail to the Artifacts page"
labels: [wayfinder:build]
status: open
assignee:
blockedBy: []
---

## Question

Connor's screenshot of Claude's Artifacts page (2026-10-16, `.context/research/claude-artifacts/`) shows two things. "Make something new" has one card per type (Docs, Slides, Design, Dashboard) with New/Beta badges. Every artifact in the grid has a rendered thumbnail. Our page (`packages/chat-ui/src/artifacts/artifacts-page.tsx`) hard-codes `starterKinds` and has no thumbnails. New kinds (163–166) should show up there by being defined, not by an edit to the page.

## Done when

- **Kind definition:** `ArtifactKindDefinition` (`packages/artifacts-kit/src/define.ts`) gains an optional `starter` with a badge (`new | beta`) and the starting prompt, plus a `thumbnail` saying how one is drawn (`runtime`, `none`).
- **Starter cards:** the page builds them from the instance's enabled kinds, in the order they're defined. Labels and prompts go through Lingui catalogs.
- **Thumbnails:** the runtime draws a thumbnail for runtime kinds (a site's home page, a deck's first slide) at about 1200×630, cached per version. The grid view shows it, and the kind icon stays as the fallback. No contract change if the image can be fetched from the artifacts origin. Otherwise stop and write the contract PR first.
- **Tests:** browser-mode tests for the cards and the fallback, and e2e on the grid.

## Owns

`packages/artifacts-kit/src/define.ts` (the two fields), `packages/chat-ui/src/artifacts/artifacts-page.tsx` and its tests, `apps/artifacts/src/**` (thumbnail route).
