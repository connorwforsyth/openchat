---
id: "070"
title: "Workspace panel: flatter hierarchy, file search, focus"
labels: [wayfinder:build]
status: closed
assignee:
blockedBy: []
---

## Question

Connor (2026-09-30): the file search / artefact workspace has too many nested borders and panel layers. Evidence is in
`docs/audits/2026-09-30/audit-ui.md`, with before-screenshots in `…/t-audit-ui/.context/before/`:
- the file view is a bordered card inside an 8px gutter, under two stacked title bars (48 + 41px); 4–6 borders per view;
- the artifact Code tab stacks 4 header strips (174px) and repeats the file name;
- the tree paints its own grey block, and the selected row has both a fill and an outline;
- there is no file search in the Workspace (`search={false}`, `workspace-panel.tsx:506`);
- the preview toolbar overflows at the 560px default;
- closing drops focus to `<body>`, Escape doesn't close the panel, S doesn't move focus in;
- typing `d` in the code editor toggles the app theme (`apps/web/components/theme-provider.tsx:36-66` doesn't see
  through shadow DOM).

Behaviours to borrow, cited in `docs/audits/2026-09-30/zettelkasten-behaviours.md`, from Connor's Zettelkasten:
- flush panel (border-left + a muted surface, not a framed card);
- one header row for actions;
- inline "/" search whose results replace the tree, one row per match, ↓/↑ previewing, Enter to commit and Escape to
  clear;
- selection on pointer-down;
- focus returned to the trigger on close, and Escape closes one layer at a time;
- animate open/close only;
- quiet hover-only actions and a single small type scale.

## Done when

- **Hierarchy.** At most one border between the panel edge and content in every view (preview, file code, file
  rendered, artifact). There is one header row per view: title/path on the left, actions on the right. Delete the
  duplicate RightPanel "Workspace" title bar, or merge it with the view header. Spacing and type do the grouping; the
  surface is flush like the Zettelkasten right panel. The tree shows no separate background block and the selected
  row has a fill only.
- **File search.** Pressing "/" in the panel, or clicking a search field at the top of the list, filters the files by
  name and path. Results replace the tree with "N found" / "Nothing found". ↓/↑ move through results and preview the
  file; Enter opens it and moves focus to the editor; Escape clears and returns to the tree. Content search is out of
  scope unless cheap; file-name search is required.
- **Navigation.** Preview/code toggles, back navigation (browser history in the preview, and a clear way back from a
  file or artifact to the list on narrow panels) and selection stay obvious. The preview toolbar never overflows at
  a 340px panel width: the address bar keeps at least 120px and the label moves or truncates.
- **Focus and keyboard.**
  - Opening the panel with S or the button moves focus into it (the search or the list).
  - Escape closes the panel when focus is inside and nothing inner is open. Closing returns focus to the trigger.
  - Single-key shortcuts and the `d` theme toggle ignore keys from inside editable elements, including through
    shadow roots (`composedPath()[0]`, like 062's shortcut fix).
- **States.** Empty, loading and error states stay, restyled to match.
- **Tests.**
  - Unit tests: the search model, the focus rules, and the `d` guard.
  - An e2e spec for file search → open → preview/code → back, and panel open/close focus.
  - After-screenshots matching the before set (same names, in `.context/after/` of your worktree).
  - Gate and e2e pass.

## Owns

`packages/chat-ui/src/workspace/**`, `packages/chat-ui/src/shell/right-panel.tsx`, `packages/code-ui/src/**` (tree/editor
chrome only), `apps/web/components/theme-provider.tsx`, `packages/chat-ui/src/shortcuts/**`,
`e2e/tests/workspace.spec.ts` (+ a new `e2e/tests/workspace-ui.spec.ts`), the Lingui catalog.

## Results

Branch `t/070-workspace-simplify` (on `origin/main` 487c6e9), not pushed; `status` stays `open`.

**Hierarchy.** The right panel has no title bar of its own (`shell/right-panel.tsx`): Close sits at the end of the view's header row. Every view has one 48px header row (the app header's height, one hairline): the list column's row is the file search; the main area's is the title (a path with a quiet folder) with its actions, then Close (`workspace/view-header.tsx`). The editor has no card and no CodeHeader (`CodeEditor` is frameless; `header={false}`); Markdown renders flush under its row; the Preview's toolbar is its row, and its canvas tint only shows at a phone's width. The Preview/Code switch is two quiet segments (eye, code), words when there's room (`mode-toggle.tsx`). The tree is `FileTree variant="flush"`: no card, and neither the host nor the rows paint the code theme's sidebar colour (the host's inline `background-color: var(--sidebar)` from `themeToTreeStyles` was the slab). The focused-row outline shows for keyboard focus only (`unsafeCSS`), so a selection is its fill. Section labels ("Files" with New file and "…", "Artifacts") are quiet; list notes are the row size. Failures (didn't start, import/delete notice) moved to a strip at the bottom so the header rows stay aligned.

Border census (audit's `census.ts`; tree indent guides and diff gutters excluded), borders / extra surfaces inside the panel, before → after:

| View | borders | surfaces | between panel edge and content |
|---|---|---|---|
| Code file | 4 → 3 | 3 → 1 | 3 (title, card, CodeHeader) → 1 (header hairline) |
| Markdown rendered | 6 → 3 | 5 → 2 | 3 + outlined toggle → 1 |
| Preview (static render) | 4 → 3 | 6 → 2 | 2 (+ tinted canvas) → 1 |
| HTML file rendered | 6 → 3 | 7 → 2 | 2 + outlined toggle → 1 |
| Nothing selected | 2 → 3 | 1 → 0 | 1 → 1 |
| Artifact preview / code | 5 → 6 / 6 → 7 | 2 → 1 / 3 → 2 | 4 → 4 (see below) |

The 3 remaining borders in file views are the list/main divider and the two header hairlines, which form one line. Chrome above code: 89px (48 + 41) → 48px.

**Not done: the artifact view.** Its title/versions row, tabs row, CodeView card and CodeHeader are in `packages/chat-ui/src/artifacts/artifact-view.tsx` (+ `artifact-preview.tsx`), which this ticket doesn't own, so I stopped short of it (ArtifactView is only rendered by the Workspace panel). It sits under a quiet "Artifact" header row with Close (and Back when narrow), so the artifact code view still stacks 4 rows (174px). Proposed follow-up: give `ArtifactView` a `headerEnd` slot and merge its title/versions and tabs into the one row, `CodeView` with `header={false}` and no card, the preview iframe without a border.

**File search** (`workspace/model/file-search.ts`, pure). "/" anywhere in the panel (not while typing; it `preventDefault`s so the composer's "/" doesn't fire) or the field filters files by name and path, every word must match, ranked name-prefix, name, path; directories are never results. Results replace the tree ("N found" / "Nothing found", one row: name, then the quiet folder). ↓/↑ wrap and preview the file with focus kept in the field (`aria-activedescendant`); Enter (or a click) opens it and moves focus into its editor (a caret at line 1) or a rendered file's view; Escape clears and focuses the tree. The tree stays mounted (hidden) while searching, so folds survive.

**Navigation.** Back/Forward/Reload and the address bar stay; the toolbar never overflows (`model/toolbar.ts`, `fitBrowserToolbar`): Back, an address bar ≥ 120px, a "…" menu, the switch and Close always fit (down to a 340px panel); Reload, then Forward, then the switch's words, then "Static render" come back as width allows (measured with a ResizeObserver: the menu is a portal, outside any container query). Mobile width and Open in a new tab moved into the menu. Below 512px the list and the view take turns: picking something shows it, a chevron "Back to the list" leads each view's row, and the already-selected file opens again from the tree; ↓/↑ previews keep the list in view.

**Focus and keyboard** (`workspace/model/focus.ts`, pure, used by `RightPanel`). Opening (button or S) focuses the panel frame, then the tree's selected/first row once it's drawn; not when someone is typing elsewhere (the agent's page auto-opening the Preview doesn't steal the composer). Escape from a field (the editor too, through its shadow root) leaves it; Escape otherwise closes the panel; Escape inside the search/address bar/menus is theirs. Closing hands focus back to what had it at open, or the header's Workspace toggle when it was opened from nowhere (S). `d`: `isTypingEvent` (exported from `shortcuts/registry.ts`, used by `useShortcuts` and `apps/web/components/theme-provider.tsx`) reads `composedPath()[0]`, so typing "d" in the editor no longer flips the theme (the audit's d-bug probe: `false false` now).

**Found and fixed.** Keys typed straight after focusing the editor programmatically went nowhere (no selection); autoFocus now places a caret at line 1. `workspace.spec`'s "survives a reload" reloaded as soon as "Saved" showed, which an untouched file also says, so with this ticket's timing it lost to the 800ms save most runs (bisected: only the editor's classes changed was enough); it now waits for the write through the API. A reload within 800ms of typing still loses the edit in the product (no flush on unload); worth a ticket.

**Tests.** chat-ui 250/250 (29 files), code-ui 36/36. New or changed: `model/file-search.test.ts`, `model/focus.test.ts`, `model/toolbar.test.ts`, `shell/right-panel.test.tsx` (focus in, Escape layers, focus back to the toggle from Close/Escape/S, no stealing from typing, no title bar), `shortcuts/registry.test.ts` (the `d` guard through a shadow root), `workspace-panel.test.tsx` (search: "/", N found, ↓/↑ preview + wrap, Enter → editor focused, Nothing found, Escape → tree; narrow turns; the toolbar's menu at 340px; the browser test's menu). e2e: new `e2e/tests/workspace-ui.spec.ts` (focus in/out and back to the toggle, S; "/" → ↓ → Enter → editor, `d` typed stays text, Escape → tree, `.html` Preview/Code; a 340px panel: no toolbar overflow, address ≥ 120px, Back to the list).

**Screenshots.** `.context/after/` (104, same names as the audit's `before/`, plus `real-*-workspace-search-{results,preview,no-results}`, `real-*-workspace-panel-340-{html-rendered,list}`, `real-mobile-*-workspace-sheet-list`), light and dark, from a production build under the browser lock. `demo-*-workspace-preview*` still shows "Select a file" (the demo's own gap, as before). Not committed (the audit's weren't either).

**Checks.** `gate.sh`: 82/82. `E2E_PORT=3533 bun turbo test:e2e`: 37/37; workspace + workspace-ui specs 3/3 runs green.

**Outside Owns:** none. (`next dev` crashes when just-bash runs, `SecurityViolationError` from its defense-in-depth; the audit's production-build server avoids it. Harness audit territory.)

## Resolution (2026-10-01, loop)

Merged on Connor's decision. Verified on the rebased branch: gate 82/82, e2e 54/54; the narrow-panel test now finds the side panel's handle by name, because #62 replaced the shared resizable handle. [PR #64](https://github.com/connorwforsyth/openchat/pull/64).
