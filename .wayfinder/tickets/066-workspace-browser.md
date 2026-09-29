---
id: "066"
title: "Workspace preview as a built-in browser"
labels: [wayfinder:build]
status: open
assignee: loop
blockedBy: []
---

## Question

Connor (2026-09-30): "I want it to actually show a preview primarily; it should work almost like a built-in browser,
similar to ChatGPT etc." Today the Workspace panel lists Preview / Files / Artifacts. Opening an HTML file shows
its source, and a preview only exists when the agent starts a server and calls `preview`.

## Done when

- **Preview is the primary view.** When the workspace has a preview (a recorded server preview, or a static-files
  preview from 067) or an HTML file, the panel opens on Preview. Browser chrome: an address bar showing the current
  page path (editable within the preview origin; Enter navigates), back / forward / reload, open in a new tab, and a
  desktop / mobile width toggle. Loading and "nothing is running" states stay (060).
- **Opens by itself.** When a run writes or edits an `.html` file, or a `preview` tool call succeeds, the panel opens
  (unless the user closed it during this run) on Preview at that page.
- **Rendered files.** Selecting an `.html` file in Files shows it rendered in the browser view at that path, with a
  **Code** toggle to the editor. Markdown files render as prose (the app's markdown renderer) with a Code toggle.
- **Chat.** File-change cards for `.html` get a primary **Preview** button (`workspaceHandle.openPreview(path)`); Open
  still opens the code.
- **just-bash fallback** (no ports, so no static server): the browser view renders the HTML file in a sandboxed
  iframe via `srcdoc` (no `allow-same-origin`), with the workspace's relative CSS/JS/images inlined (read through the
  existing `readFile`, capped in size). It's labelled as a static render.
- Styling follows the template-inspired shell (semantic tokens, @workspace/icons, Lingui, D28 motion). Unit tests
  cover the chrome, navigation history, auto-open rules, HTML/Markdown rendered↔code, and the srcdoc inliner. e2e: a
  `[tool:write {"path":"index.html",…}]` run opens Preview showing the page (Docker-less e2e uses the srcdoc path).

## Owns

`packages/chat-ui/src/workspace/**`, `packages/chat-ui/src/conversation/file-change-card.tsx`,
`packages/chat-ui/src/chat/{chat-screen,connected-chat}.tsx`, `e2e/tests/workspace.spec.ts`, the Lingui catalog.
