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

## Results

Branch `t/075-artifact-view-and-search-rows`, stacked on `t/070-workspace-simplify` (draft PR #64), not pushed; `status` stays `open`.

**Artifact view.** `ArtifactView` takes a `header` slot, `(content) => ReactNode`: the Workspace panel wraps the view's title, versions and Preview/Code/Changes tabs in its `ViewHeader`, so they share the one 48px row with Back (when narrow) and Close. The panel's own quiet "Artifact" row, the title/versions row, the tabs row and the CodeHeader (48 + 41 + 45 + 40 = 174px of chrome over the code) are now that one row (48px). The loading and "No artifacts yet" states keep the row too. The tabs are quiet segments like the files' Preview | Code switch (eye, code, history icons; the word shows when there's room; the selection is the fill, no raised pill). What fits is a pure model like 070's toolbar (`artifacts/header-fit.ts`, `fitArtifactHeader`): the title keeps 96px and the tabs always show as icons; the version pager, then the tabs' words, come back as room allows; a pager with no room moves into a "…" menu ("Version 2 of 2", Older version, Newer version). One version has no pager. The code is `CodeView header={false}` with no card; the previews (srcdoc and runtime iframes) and the rendered Markdown sit flush, with no 12px gutter or frame; the runtime's error is a strip instead of a card.

Border census (the audit's `census.ts`, demo `/dev/chat`, desktop 1440; tree indent guides and code gutters excluded; "before" is 070's census on this branch's base):

| View | borders in the panel | extra surfaces | between panel edge and content |
|---|---|---|---|
| Artifact preview (benchmark.html) | 6 → 3 | 1 → 1 | 4 (header, title row, tabs row, iframe frame) → 1 (header hairline) |
| Artifact code | 7 → 3 | 2 → 1 | 5 (header, title row, tabs row, card, CodeHeader) → 1 |
| Artifact changes (new) | – → 5 | – → 3 | 2: the header, then DiffView's own strip |

The 3 remaining borders are the list/main divider and the two header hairlines, the same as the file views. The one remaining surface is the list's selected row. Light and dark are the same. The active tab still shows as "shadow" in the census; that's the transparent `shadow-none` value (the census counts any `box-shadow`), as it did before.

**Not done: the Changes tab's strip.** `DiffView` (`packages/code-ui/src/diff-view.tsx`, outside Owns) always draws its CodeHeader: the path again, +/− counts and the Unified/Split switch. Its card is gone (`className="rounded-none border-0"`), but the strip stays. Follow-up: give `DiffView` a `header={false}` (or a `headerEnd` slot) and move the counts and switch into the artifact's row or its "…" menu.

**Search rows.** Each result is the file name, then its folder under it in muted `text-xs`, after the Zettelkasten's title-then-snippet. Both lines truncate in the middle: `nameTailStart` keeps the extension and the stem's last whole words (the shortest run of at least 6 characters, at most 12, else the last 6; separators and camelCase count as word starts), so the eight `very-long-component-file-name-number-N.tsx` read `very-long…number-1.tsx` … `number-8.tsx`. `directoryTailStart` keeps the last folder (`src/…components/`). The head is `text-ellipsis`, and the tail is `shrink-0 max-w-full`: any flex-shrink at all put an ellipsis on the tail. Query hits are marked in both lines (`highlightRuns` over the whole path, so a term across the last "/" marks both sides; overlapping hits merge; text whose length changes when lower-cased isn't marked). The marks are `<mark>` with `bg-primary/10 text-foreground`: `globals.css` has no highlight token (nothing like the Zettelkasten's blue tint), and `packages/ui` is outside Owns, so this uses an existing semantic token at 10% instead of a new colour. A `--highlight` token would be a small `packages/ui` follow-up. A mark cut by the head's ellipsis shows as a thin tinted sliver before the "…". 070's keyboard behaviour (/, ↓/↑ wrap with preview, Enter, Escape) is unchanged.

**Tests.** chat-ui 275/275 (31 files). New: `artifacts/header-fit.test.ts` (fit order, the default width keeps the pager, one version, two tabs), `artifacts/artifact-view.test.tsx` (one row in the host's frame with Close, words wide and icons narrow, the "…" menu pages versions, no pager for one version, no second file name or card in Code, the row while loading and when empty), `model/file-search.test.ts` (`highlightRuns`, `sliceRuns`, `nameTailStart`, `directoryTailStart`, `resultLabel`), and a `workspace-panel.test.tsx` case for the row's head, tail, folder and marks.

**Screenshots.** `.context/after/` (108 files, from a production build on :3561 under the browser lock, same names as 070's). Artifacts: `demo-desktop-{light,dark}-workspace-artifact-{html,react,markdown,mermaid}-*` (the markdown ones now include `-code` and `-changes`), new `demo-desktop-*-workspace-artifact-panel-340(-menu)` (the versions folded into "…"), and `demo-mobile-*-workspace-sheet-artifact-html`. Search: `real-desktop-*-workspace-search-{results,preview,no-results}`, plus new `real-desktop-*-workspace-search-results-two-terms` ("comp 7", marks in the name and the folder). Not committed. The demo's `ws-preview` step still fails ("Select a file", the demo's own gap, as in 070).

**Checks.** `gate.sh`: 82/82. `E2E_PORT=3563 bun turbo test:e2e`: 37/37.

**Outside Owns:** none edited. `ArtifactView` imports `useElementWidth` from `workspace/`.
