---
id: "066"
title: "Workspace preview as a built-in browser"
labels: [wayfinder:build]
status: closed
assignee:
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

## Results

Branch `t/066-workspace-browser` (rebased on `origin/main` after 067 merged), not pushed; `status` stays `open`.

**The browser** (`workspace/preview.tsx`, `BrowserView`; pure rules in `workspace/model/browser.ts`).
- Preview is a `<section>`'s main view with a toolbar: Back, Forward, Reload, an address bar (the page's path; Enter navigates on the preview's origin, a bare `about.html` means `/about.html`, another origin is refused with `aria-invalid`; Escape restores), a **Mobile** toggle (390 px, bordered, no animation), and **Open in a new tab** for served pages.
- A cross-origin frame can't be read, so history is the panel's own (`browserHistory`: entries, index, `loads`, which keys the frame so the same page loads again). The Preview's history lives in the panel while it's open (`use-preview-history.ts`) and follows the workspace's default page until someone navigates.
- Where a page comes from (`targetOf`): an HTML path prefers the static-files preview (`STATIC_PREVIEW_PORT` from `@workspace/sandbox/tools/static-preview`, 4747), then the newest server, then a static render; any other path is the agent's server's, then the static one's. just-bash never serves, whatever the record says. A page from a `preview` URL is pinned to that server. The default page: the agent's server, else `index.html` (or the first page).
- Served pages keep 060's check ("Connecting to port…", "Nothing is running on port N yet…" with Retry). Every frame is `sandbox="allow-scripts allow-forms allow-popups allow-modals"`, never `allow-same-origin` (D24).
- The list shows **Preview** whenever there's something to show (a server or an HTML file), not only a recorded preview.

**Static render** (`workspace/model/static-page.ts`). For just-bash (or before 067's server answers): the HTML file is read through `readFile`, its local `<link rel=stylesheet>`, `<script src>` and `<img src>` inlined (resolved against the page; remote, `data:` and `#` refs left alone; images as data URLs) up to 2 MB in document order, and shown in a `srcdoc` frame labelled **Static render** in the address bar (with a title explaining it). Inlined text can't close its element early. A small script posts relative link clicks to the panel, which renders the linked page (so links, Back and Forward work). No new-tab button: a static render has no origin to open.

**Opens by itself** (`workspace/model/auto-open.ts`, wired in `chat-screen.tsx`). When a `write`/`edit` of an `.html` file lands (applied hunks), or a `preview` call succeeds, the panel opens on Preview at that page. It only counts results in a message already on screen or streaming, so a chat opened with such calls in its history, or a branch switched to, stays as it was. It doesn't open if the person closed the panel during that run (the Workspace button, Close, or S/A while it's open).

**Rendered files** (`workspace/rendered-file.tsx`). An `.html` file in Files opens in its own browser at its path; Markdown renders as prose with the message renderer (`conversation/markdown.tsx`). Both have a **Preview | Code** toggle ("Show as"); Code is the same editor, with the toggle in its header. Switching to Preview saves pending edits first, and a save reloads the page. A file that opens empty (a new one) opens as code. The mode is remembered per file while the panel is open.

**Chat.** `.html` file-change cards lead with a primary **Preview** (`Preview {path}`), then Open (code). `WorkspaceHandle.openPreview(path?)` opens the Preview at a workspace page; the preview status line's Open goes to that URL's server and path. `/preview` opens the Preview whenever there's a page, not only a recorded server.

**Found in e2e and fixed** (`connected-chat.tsx`): an approval decided before the runs list had caught up with the pause was dropped (`onDecide` returned without a run id), leaving "Decision sent. Waiting for the agent…" forever. It now asks the server for the run awaiting that call, up to 10 times, 500 ms apart.

**Outside Owns, minimal:** `packages/chat-ui/package.json` + `bun.lock` (a `@workspace/sandbox` dependency, for 067's port constant, as the loop asked). The card's Preview comes through a `FilePreviewContext` exported from `file-change-card.tsx` and provided by `ChatScreen`, to stay inside Owns; an `onPreviewFile` in `ConversationActions` (`actions.tsx`) would be the more usual shape if someone wants to move it.

**Not done / notes.**
- There's no phone icon in `@workspace/icons` (`names.ts`), so the width toggle is a text **Mobile** toggle. Adding `SmartphoneIcon` (lucide has it) would let it be an icon.
- A served page's in-frame navigation (a link clicked inside a Vite app) can't update the address bar: the frame is cross-origin. The static render's links do.
- `/dev/sandbox`'s pretend preview (port 5173 on a just-bash record) is no longer listed, since just-bash can't serve; the demo shows static renders instead.

**Tests.**
- chat-ui 212/212. New: `model/browser.test.ts` (targets, default page, preview URLs, addresses, links, file modes, history), `model/static-page.test.ts` (inlining, remote refs, the cap, the link script, `workspaceRef`), `model/auto-open.test.ts` (what opens, history doesn't, streaming, branch switch, newest first). `workspace-panel.test.tsx`: served page chrome (address, Back/Forward, refused origin, Reload re-checks, new tab, mobile width), static render (inlined CSS, label, no new tab, link → next page, request navigates), missing page, `.html` file rendered↔Code, Markdown prose↔Code, empty Markdown opens as code. `chat-screen.test.tsx`: opens on a page write, not for history, not after closing during the run, the card's Preview, `openPreview(path)`.
- e2e: new "a page the agent writes opens in the Preview by itself, as a static render without Docker" (`[tool:write index.html]` → Approve → the panel is open on Preview, address `/index.html`, "Static render", the heading inside the frame; the card has Preview; Open → rendered file → Code → editor). The hello.md tests click Code, since Markdown now opens rendered.

**Checks.** `gate.sh`: 82/82. `E2E_PORT=3511 bun turbo test:e2e`: 33/33 (the first run, before the approval fix, lost that race twice; `memory.spec`'s shared-chat test also failed once, as noted in 060, and passed since).
Screenshots of `/dev/sandbox`: Markdown rendered; an `.html` file rendered with its CSS and in Code; Preview; after following a link; mobile width, light and dark.

## Resolution (2026-09-30, loop)

Merged in [PR #59](https://github.com/connorwforsyth/openchat/pull/59). Browser chrome, auto-open, rendered HTML/Markdown with a Code toggle, srcdoc fallback, and a fix for dropped approvals. chat-ui 212/212, e2e 33/33, gate 82/82. Follow-ups: a `SmartphoneIcon` for the Mobile toggle; move the card's Preview to `actions.onPreviewFile`.
