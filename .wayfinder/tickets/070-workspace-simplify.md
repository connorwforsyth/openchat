---
id: "070"
title: "Workspace panel: flatter hierarchy, file search, focus"
labels: [wayfinder:build]
status: open
assignee: loop
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
