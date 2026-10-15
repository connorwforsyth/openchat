---
id: "161"
title: "Kinds bring their starter card and thumbnail to the Artifacts page"
labels: [wayfinder:build]
status: open
assignee: loop
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

## Results (2026-10-16)

**Built**

- `ArtifactKindDefinition` gains `starter?: { badge?: "new" | "beta"; order? }` and a required `thumbnail: "runtime" | "none"` (`packages/artifacts-kit/src/define.ts`), plus `starterKindsOf` (pure: kinds with a starter, by `order`, then definition order). The starting prompt isn't in the kit: the kit can't hold user-facing strings, so the card's label and prompt stay Lingui messages in chat-ui, keyed by kind.
- Every built-in kind declares `thumbnail`. Starters: document, html, mermaid, react, svg, and site (badge `beta`). Code, markdown and image have none, as before.
- The page builds the cards from `starterKinds(kinds)`. `ArtifactsPage` takes an optional `kinds` prop (the instance's enabled kinds; all built-ins when left out), and the cards show the badge (`New`/`Beta`, Lingui with context `artifact kind badge`).
- Grid cards render `ArtifactThumbnail` (`packages/chat-ui/src/artifacts/artifact-thumbnail.tsx`): a lazy, decorative 1200×630 `<img>` for kinds whose `thumbnail` is `runtime` when the host's optional `thumbnailUrl(item)` returns a URL, and the kind icon otherwise or when the image fails to load.

**Verified**

- Unit: `starterKindsOf` ordering (`define.test.ts`).
- Browser mode (`artifacts-page.test.tsx`): cards from the enabled kinds in order with the Beta badge, starting a chat; a kind left out when not enabled; grid thumbnail for a runtime kind with the icon for a `none` kind (whose URL is never asked); icon fallback on a broken image.
- `bun run check`, `bun turbo typecheck lint test` for artifacts-kit, chat-ui, artifacts and web; Lingui catalog extracted.

**Not done (gaps)**

- **The runtime doesn't draw thumbnails yet.** A thumbnail route in `apps/artifacts` needs (a) the content of a private artifact's version, but the runtime can only fetch published ones (`GET /api/published/{token}`), and (b) a headless rasteriser to make the 1200×630 image, cached per version. (a) needs a new contract route (say, a signed per-version content or thumbnail URL on `ArtifactListItem`) and a server change, so per the ticket that's a contract PR first. Until then `apps/web` doesn't pass `thumbnailUrl`, and the grid shows icons.
- **`apps/web` doesn't pass `kinds`.** Whether Site is enabled isn't in the public config, so the page offers every built-in starter. Passing the instance's kinds needs `artifacts.kinds` (or similar) on `publicConfigSchema`, which is a contract change.
- No e2e on the grid: it would only show icons until the runtime route exists.
