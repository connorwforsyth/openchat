---
id: "097"
title: "Workspace panel: the browser on top, the files below"
labels: [wayfinder:build]
status: open
assignee: loop
blockedBy: []
---

## Question

Connor asked (2026-10-01) to separate the file viewer from the browser preview: the browser on top and the files on the bottom. Today `MainArea` in `packages/chat-ui/src/workspace/workspace-panel.tsx` switches one main area between a file, an artifact and the preview, with a list beside it (070 flattened it, now on `main`).

## Done when

- The panel is a vertical split: the **browser** (`BrowserView`, the preview) on top and the **files** (tree, and the open file's editor or rendered view) below, with a draggable divider (keyboard-operable, double-click resets, position saved per user like the sidebar width from 071).
- When there's nothing to preview yet, the browser half collapses to a slim bar (or hides) so files get the whole height; it opens on its own when a page or server appears, as it does today.
- Either half can be maximised and restored. At narrow widths (under ~420px) the halves take turns instead of stacking, keeping 070's back-to-the-list behaviour.
- Opening an HTML file still previews it in the browser half; opening other files shows them in the files half. Artifacts keep working where they are today (their future is a separate decision).
- Focus and Escape behave as 070 set up. e2e covers: split visible with a preview, resize and reload keeps it, narrow width takes turns, a file opens below while the preview stays above. Gate and e2e pass. No `packages/contract` change.

## Owns

`packages/chat-ui/src/workspace/**`, `packages/chat-ui/src/model/workspace.ts`, `packages/i18n/locales/**`, `e2e/tests/workspace*.spec.ts`, `e2e/support/**` (helpers only).

## Results (2026-10-01, loop)

Branch `t/097-workspace-split` (on `origin/main` 2d5fa1e), not pushed; `status` stays `open`.

**Layout** (`workspace/workspace-panel.tsx`; the rules are pure in `workspace/model/split.ts`, `paneLayout`). The panel is the browser (`BrowserView`, the Preview) on top and the files (the list beside the open file or artifact, as 070 left them) below. Each half has its one 48px header row. The panel's Close ends the top row only. Each half's row ends with a Maximise toggle (`aria-pressed`). A `RowEnd` context in `view-header.tsx` tells a view's row which of these it has, since the views don't know which half they're in. States:
- **No preview:** there's no browser at all. The files take the whole height and their row has Close. The browser appears by itself once there's a page or a server (`usePreviewHistory`'s default page, as before).
- **Preview:** the two halves are stacked, with the divider between them.
- **Maximised:** the other half is hidden, not unmounted, so the page and the editor keep their state. A pick brings back the half it shows in (`maximisedAfter`): picking the Preview or an HTML file brings back the browser, and any other file or artifact brings back the files. So does a page the chat asks for. While the files are maximised, the list shows a Preview row.
- **Narrow:** below 420px (`SPLIT_BELOW`) the halves take turns. The browser's toolbar leads with 070's Back to the list, and the list has a Preview row that goes back to the browser. Below 512px the list and the file still take turns inside the files half. The phone sheet behaves the same way. The Preview opens on the browser's turn, as it did before.

**Files and pages.**
- Opening an `.html` file sends the browser to its path (once per pick) and shows its code below. Wide, there's no Preview/Code switch. When the halves take turns, the switch comes back, on the browser's toolbar and in the code's row, and moves between the two turns.
- A save reloads the page, because the file's etag is part of the browser's `refreshKey`.
- Markdown keeps its rendered/Code switch in the files half (`rendered-file.tsx` is now Markdown only).
- Artifacts show in the files half, where the main area always showed them.
- When the chat picks the Preview (`{kind:"preview"}`, e.g. an agent's page write), the open file stays below (`useFilesSelection`).

**Divider** (`workspace/split-handle.tsx`). 071's handle turned on its side, kept in `workspace/`, because `ResizeHandle` in `packages/ui` only drags across and `packages/ui` is outside Owns. It's an 8px hit strip with a 1px `border` line, `foreground/40` on hover, `/60` while dragging and `ring` on focus. It uses pointer capture, `user-select: none` while dragging, ↑/↓ moves it 16px, Home/End go to the limits, and a double-click resets it to half. `role="separator"`, `aria-orientation="horizontal"`, `aria-valuenow` in percent, `aria-controls` the browser. It sits at z-10, under the side panel's handle (z-20) where the two cross. Each half keeps at least 120px.

**Persistence** (`workspace/use-split.ts`). The browser's share of the height is stored in `localStorage["chat-ui:workspace-split"]`. It's written on release, key press or reset, and read when the panel mounts. The panel only mounts on the client, after the shell has read that it's open, so a reload paints the saved split at once. A share rather than pixels, so it fits any window height.

**Focus and Escape:** unchanged from 070. Opening moves focus to the tree; Escape leaves a field, then closes. "/" goes to the search (on a narrow panel it shows the list first). Enter in the search opens the file's code, an HTML file included.

**Tests.**
- chat-ui unit tests:
  - `model/split.test.ts` (new): bounds, clamp, parse, every layout state, `viewOf`, `maximisedAfter`.
  - `model/toolbar.test.ts`: the Maximise fits at 420px.
  - `workspace-panel.test.tsx`, a new "the browser over the files (097)" block: only the files with no preview, with one Close; stacked with Close at the top; ↓ moves and saves the divider, a remount reads it, double-click resets it; both Maximises, and a pick restores; the open file stays when the chat picks the Preview; turns at 360px; an HTML file's Preview/Code switch on turns.
- Changed unit tests:
  - "lists the preview…" is now "lists the files and the artifacts under the browser": there's no Preview row when the browser is on screen.
  - The static render test expects the Browser region instead of a Preview row.
  - "opens an .html file … with a Code toggle" is now "… and its code below": frame and editor together, no switch.
- e2e `workspace-split.spec.ts` (new): split visible with a preview and one Close at the top; a file opens below while the page stays; drag, then a reload keeps it (±2px), ↑ nudges, double-click resets to 50; both halves maximise and restore; at a 360px panel the halves take turns (Back to the list, Preview).
- Changed e2e selectors:
  - `workspace-ui.spec` (file search): `index.html` no longer has a Show as / Code click. The test checks the frame's heading, the editor's text and that there's no Show as group.
  - `workspace.spec` (agent page write): `showCode(panel)` for `index.html` is gone. The test checks the editor's text and that the frame is still visible. Wide, the code is already below the page.

**Checks.** `gate.sh`: 82/82. `E2E_PORT=3198 bun turbo test:e2e`: 58/59 on the first run. The one failure was `harness.spec` "a change whose file is edited meanwhile…", which timed out waiting for the agent's card at line 458, before the panel is touched. `harness.spec` alone then passed 11/11. With it, 59/59: main's 54 plus the 5 new tests.

**Screenshots** (not committed): `/private/tmp/claude-501/097-screens/`.
- `before-*` and `after-*` for `{desktop,phone}-{light,dark}-{preview,file}`.
- After only: `desktop-*-{files-maximised,browser-maximised,html-file}`.
- The phone "before" file shots show the search list: that script's ↓/Enter didn't open the file in either build. The "after" script clicks the result instead.

**Outside Owns:** none. `packages/i18n/locales/en/messages.po` was extracted. That's in Owns.

**Open questions.**
1. Restoring uses the same Maximise icon, pressed. `@workspace/icons` has `Maximize2Icon` but no `Minimize2Icon`, and adding one is a `packages/icons` change.
2. `ResizeHandle` (packages/ui) could take an `orientation`, so the sidebar's handle and this divider are one component.
3. Maximised state is per panel visit; only the divider's position is saved. Should a maximised half survive closing the panel?
4. An HTML file opened wide always shows its code below. Is that the right default, or should the files half fold away for an HTML file until someone asks for its code?
