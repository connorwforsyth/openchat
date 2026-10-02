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
