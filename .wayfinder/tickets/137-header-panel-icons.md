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

- The header shows Files and Globe icon buttons, each with a tooltip and a pressed state, where the PanelRight toggle was. The overflow menu's "Workspace" item matches (Files / Browser).
- Files focuses the files half (it restores it if the browser was maximised), and Globe focuses or maximises the browser half. If there's no preview yet, Globe shows the browser's empty state ("Nothing running yet").
- The S and A shortcuts still work. If Artifacts lost its entry point, it stays reachable (a tab in the panel, or the overflow menu).
- The preview toolbar has a device menu (Desktop / Tablet 768 / Phone 390). The page renders at that width, centred, with a device-frame outline. The choice is per chat and remembered for the session.
- Tests: unit, plus e2e covering both icons and the device switch. Light and dark, desktop and 375px screenshots checked by eye.

## Results (2026-10-02, loop)

Built on `t/137-header-icons` (not pushed).

- **Header.** `header/panel-toggles.tsx` replaces `workspace-toggle.tsx`: Files (FolderIcon) and Browser (GlobeIcon), each with a tooltip (Files shows its S key) and `aria-pressed`. A press on the half that's showing closes the panel; a press on the other switches. The overflow menu (narrow screens) has the same two items as checkboxes, so nothing shifts at 375px.
- **Halves.** The layout's sections are now `files | browser | artifacts` (a stored `"browser"` reopens there). The Preview's selection belongs to `browser`, so the Globe shows as pressed when the agent opens a page too. A press sends the panel a `HalfRequest`. The Globe maximises the browser (the whole panel; its turn on a narrow panel), and Files brings the files back from a maximised browser (its turn when narrow). With no preview yet, the Globe shows the browser with a new empty state: "Nothing running yet".
- **Device menu.** It sits in the Preview toolbar after Forward: Desktop, Tablet (768 px) and Phone (390 px). Its icon is the device in use. When the row has no room, the choices move into the "…" menu (`fitBrowserToolbar` gained `device`). The page renders at that width, centred, inside a rounded outline on a muted stage. A half that's narrower than the device scrolls sideways. The choice is kept per chat in `sessionStorage` (`chat-ui:preview-device:<chat id>`). It replaces the "Mobile width" checkbox.
- **Artifacts.** They're still in the files' list (its Artifacts section) and on A. Artifacts count as the files half, so Files shows as pressed for them.
- **Shortcuts.** S toggles the files and A toggles the artifacts, as before. S's label is now "Show or hide the files" (the registry, which also labels the desktop menu) and "Files" in the hints. A panel opened with S hands focus back to Files when it closes.
- **Icons.** FolderIcon, SmartphoneIcon and TabletIcon are mapped in lucide, lucide-native and phosphor. Material isn't mapped yet, because that needs `icons:vendor`, which downloads packages; it falls back to lucide.
- **Tests.** Unit tests cover the header toggles, S/A, the overflow menu, `halfOf`, `sectionOf`, `maximisedForHalf`, `viewForHalf`, the toolbar fit, a Globe or Files press on the panel, the empty state and the per-chat device. In e2e, both icons open and switch and a second press closes; the device switch is checked for 390px, centring and a reload. The existing specs now use Files.
- Screenshots checked by eye in light and dark, at 1280 and 375.
