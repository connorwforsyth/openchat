---
id: "137"
title: "Header: Files and Globe (browser) icons instead of one right-panel toggle; a device-size switch in the web preview"
labels: [wayfinder:build]
status: in-progress
assignee: loop
blockedBy: []
---

## Question

Connor (2026-10-02): "instead of having a right sidebar icon - can we have a files icon and a globe / and a little device icon for the web preview?"

Reading: replace the header's single `WorkspaceToggle` (PanelRight) with two icons. **Files** opens the workspace panel on the files half; **Globe** opens it on the browser (web preview) half. Each toggles: pressing the one that's showing closes the panel, and pressing the other switches. Inside the web preview's toolbar, a small **device** icon switches the preview's viewport between desktop, tablet and phone widths.

## Done when

- The header shows two icon buttons where the PanelRight toggle was: **Files** with a folder icon, and **Browser** with a browser-window icon (`AppWindowIcon`), not a globe. Each has a tooltip and a pressed state. The overflow menu's "Workspace" item matches (Files / Browser).
- Files focuses the files half (it restores it if the browser was maximised), and Browser focuses or maximises the browser half. If there's no preview yet, Browser shows the browser's empty state ("Nothing running yet").
- The S and A shortcuts still work. If Artifacts lost its entry point, it stays reachable (a tab in the panel, or the overflow menu).
- Tests: unit, plus e2e covering both icons. Light and dark, desktop and 375px screenshots checked by eye.

## Clarified (2026-10-02)

Connor: "I want the right sidebar icon to not be a right sidebar icon - instead be a files / folder icon - and then the integrated browser thing can be a kind of like a window icon? Almost like a browser." So the buttons are a **folder** icon (Files) and a **browser-window** icon (the integrated browser), not a globe. The "device icon" meant the browser button, so the viewport device menu is out of scope (it can be offered separately).

## Results (2026-10-02, loop)

Built on `t/137-header-icons` (not pushed).

- **Header.** `header/panel-toggles.tsx` replaces `workspace-toggle.tsx` with two buttons: Files (FolderIcon) and Browser (AppWindowIcon, a window with a top bar). Each has a tooltip (Files also shows its S key) and `aria-pressed`. Pressing the half that's showing closes the panel, and pressing the other half switches to it. On narrow screens the overflow menu has the same two items as checkboxes, so the header doesn't shift at 375px.
- **Halves.** The layout's sections are now `files | browser | artifacts`, and a stored `"browser"` reopens there. The Preview's selection belongs to `browser`, so Browser shows as pressed when the agent opens a page too. A press sends the panel a `HalfRequest`. Browser maximises the browser (on a narrow panel, the browser's turn). Files brings the files back from a maximised browser (when narrow, the files' turn). With no preview yet, Browser shows the browser with a new empty state: "Nothing running yet".
- **Artifacts.** They're still in the files' list (its Artifacts section) and on A. Artifacts count as the files half, so Files shows as pressed for them.
- **Shortcuts.** S still toggles the files and A the artifacts. S's label is now "Show or hide the files" in the registry, which is what the desktop menu uses, and "Files" in the hints. When a panel opened with S closes, focus goes back to Files.
- **Icons.** FolderIcon and AppWindowIcon are mapped in lucide, lucide-native and phosphor (`Folder`, `Browser`). Material isn't mapped: mapping it needs `icons:vendor`, which downloads packages. Until then it falls back to lucide.
- **Device menu.** It was built (Desktop / Tablet 768 / Phone 390, per chat in sessionStorage) and then removed after the clarification. The Preview keeps its old "Mobile width" checkbox. The menu can come back as its own ticket.
- **Tests.** Unit tests cover the header toggles, S and A, the overflow menu, `halfOf`, `sectionOf`, `maximisedForHalf`, `viewForHalf`, a Browser or Files press on the panel, and the empty state. In e2e, both icons open the panel and switch halves, a second press closes it, and Browser on a new chat shows the empty state. The existing specs now use Files.
- Screenshots were checked by eye in light and dark, at 1280 and 375.
