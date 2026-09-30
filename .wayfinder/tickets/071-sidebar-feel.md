---
id: "071"
title: "Sidebar: ChatGPT-like rhythm, drag resize, collapse, persistence"
labels: [wayfinder:build]
status: open
assignee: loop
blockedBy: []
---

## Question

Connor (2026-09-30) wants the app sidebar to feel more like ChatGPT's: spacing and row rhythm, useful title
truncation, quiet actions, smooth drag resizing with sensible min/max, collapse/expand, persistent width, and
responsive behaviour. The audit (`docs/audits/2026-09-30/audit-ui.md`) found:
- a fixed 256px width with no handle;
- 32px rows;
- titles always cut 32px early for a hidden action;
- a barely visible active row in light mode;
- instant all-or-nothing collapse;
- 32px touch rows;
- a bug: renaming from a row's menu does nothing after another row's menu was opened and closed (`rename-input.tsx:55`:
  focus return blurs the input and blur commits "no change").

The right panel's handle is a 1px line with no hover state and no label.

Behaviours to borrow, from Connor's Zettelkasten (`docs/audits/2026-09-30/zettelkasten-behaviours.md`):
- the sidebar is 200–420px, default 256px, saved in a cookie so the server renders it without a jump;
- the handle is an 8px hit strip with a 1px line on hover;
- pointer capture, save on release, no text selection while dragging;
- double-click resets, and ←/→ nudge by 16px;
- the handle is a WAI-ARIA separator;
- "[" toggles the sidebar, guarded while typing;
- a collapsed sidebar "peeks" on a 20px edge hover without moving the page, and closes 500ms after the pointer
  leaves;
- the mobile drawer closes on navigation;
- animate open/close only; docked resize is instant; motion-reduce is respected;
- rows are 28–36px with a clear active fill (`foreground/8` + medium), hover-only actions, and 44px touch rows.

## Done when

- **Rows.** Rows are about 34–36px desktop and 44px touch (coarse pointer), 14px text, with consistent section
  spacing. The active row is clearly visible in light and dark. Titles truncate with a fade (mask), not an early
  ellipsis. The full title shows as a tooltip or `title` when truncated. Row actions (⋯) appear on hover or focus
  only, overlaying the fade rather than reserving width.
- **Resize.**
  - A drag handle on the sidebar edge: 8px hit area, 1px line on hover or drag, pointer capture, no text selection
    while dragging.
  - Min 200px, max 420px, default 260px.
  - The conversation column keeps at least 480px, so the sidebar or right panel yield.
  - Double-click resets; ←/→ nudge by 16px with Home/End for the limits; `role="separator"` with an `aria-valuenow`
    range.
  - The width is saved on release and restored on reload without a layout jump. Prefer a cookie read on the server
    (the Zettelkasten pattern); the existing `shell-prepaint.ts` approach is acceptable if it avoids the flash.
- **Right-panel handle.** Gets the same handle treatment and label, and its min/max keep the 480px centre rule.
- **Collapse.**
  - "[" and the toggle button collapse and expand; the toggle is guarded while typing.
  - A collapsed sidebar peeks on edge hover (20px strip) as an overlay that doesn't move the page, and closes 500ms
    after the pointer leaves unless a menu or search inside is active.
  - Collapsed state persists across reload.
- **Responsive.** Below 768px the sidebar is a drawer, as today, closing on navigation. The layout reflows cleanly at
  900px and 1024px.
- **Motion.** Open/close only, token durations, motion-reduce respected; no animation for keyboard toggles or resize.
- **Bug fix.** Renaming works after any sequence of menu opens and closes (commit on Enter; a blur caused by focus
  return must not commit an unchanged value before the user types). Add a regression test.
- **Tests.**
  - Unit tests: the width clamp, persistence, and the peek timing.
  - An e2e spec for resizing (drag and keyboard), persistence across reload, collapse/expand with "[", peek, and
    rename after menu toggles.
  - After-screenshots matching the before sidebar set.
  - Gate and e2e pass.

## Owns

`packages/chat-ui/src/sidebar/**`, `packages/chat-ui/src/shell/app-shell.tsx`, `packages/chat-ui/src/model/layout.ts`,
`apps/web/app/(app)/_shared/{app-frame.tsx,shell-prepaint.ts,use-shell-layout*}`, `apps/web/app/(app)/shell.css`,
`packages/ui/src/components/resizable.tsx` (if needed), `e2e/tests/shell.spec.ts` (+ a new `e2e/tests/sidebar.spec.ts`),
the Lingui catalog.
