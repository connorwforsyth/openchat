# UI audit (before): Workspace panel and app sidebar

Worktree `t/audit-ui` at `origin/main` 487c6e9, 2026-09-30. No production code changed.

**How it was run.** Production build (`next build`) served by `.context/tmp/serve-audit.ts`. It is a copy of `e2e/support/serve.ts` with the mock model, PGlite in a temp dir, port 3521 and `ENABLE_DEV_ROUTES=1`. Screenshots were taken with Playwright Chromium, always under `scripts/ci/browser-lock.ts`, at 1440×900 and 390×844, in light and dark. The runs covered:

- `/dev/chat`: the full `ChatScreen` over fixtures and an in-tab just-bash workspace.
- `/dev/code`: the `FileTree` with search on.
- The real app: first sign-up as the e2e `ada` test user, five chats, and one chat whose files come from a mock `[tool:bash …]` call.

Measurements (computed styles, DOM chains, a border census inside the panel) are in `.context/tmp/*.json`. The scripts are in `.context/tmp/*.ts`.

Screenshots are in `.context/before/` (96 PNGs). Naming is `<source>-<desktop|mobile>-<light|dark>-<state>.png`. `-crop` files are clipped to the sidebar or the panel.

---

## 0. Top problems (ranked)

1. **Card-in-panel-in-panel.** A file opened in the Workspace sits in a bordered, rounded card (`rounded-lg border`) inside an 8 px gutter. That card is inside the panel, which already has a 1 px edge, a 48 px title bar and a list/main divider. The card then adds its own tinted 40 px header strip. That makes **3 framed levels + 2 stacked title bars** before the first line of code. Markdown files have the same frame, plus an outlined segmented toggle.
2. **Artifact Code view: 4 stacked header strips before content.** The strips are Workspace title (48 px) → artifact title/version row (41 px) → tabs row (45 px) → CodeHeader (40 px). The CodeHeader repeats the file name that the title row already shows. That is 174 px of chrome, and the content is also inside a bordered card inside a 12 px gutter.
3. **The file tree is a separate grey surface.** `file-tree-container` paints its own background: the Shiki theme background via `treeHostStyle`, lab(98.26) in light, lighter-than-panel in dark. The wrapper's `bg-transparent` does not remove it. The result is a rounded grey slab inside the list column, which already has a `border-e`. The selected row adds an outlined box (`--trees-selected-focused-border-color: var(--ring)`) on top of a fill, so selection is fill + ring.
4. **No file search in the Workspace.** `FileTree` has a search field (`useFileTreeSearch`), but the panel passes `search={false}` (workspace-panel.tsx:506). The library's own type-to-search (`search: true` on the model) is never enabled either. Typing in the tree does nothing. Search exists only on `/dev/code` and the library skill form.
5. **The Browser toolbar overflows at the default width.** On an `.html` file at the 560 px default (main area 368 px), the toolbar holds three icon buttons, an InputGroup, a Mobile toggle and the outlined Preview/Code segmented control. The address input is squeezed to **16 px wide** (address group 81 px), and "Static render" wraps onto two lines. See `real-desktop-*-workspace-file-html-rendered.png`.
6. **The sidebar is fixed and not resizable.** It is `w-64` (256 px) with no handle, no min/max and no stored width (app-shell.tsx:124). Collapse is all-or-nothing: no rail, and it is instant. The right panel is the only resizable edge. Its handle is a bare 1 px line with no hover or active affordance and no `aria-label`.
7. **Sidebar rows are denser and quieter than ChatGPT's.** Rows are 32 px (ChatGPT is roughly 36 px). Every title reserves 32 px on the right (`pe-8`) for an action that is hidden until hover, so titles are cut with an ellipsis about 32 px early. The active row is `bg-sidebar-accent`: oklch 0.97 on 0.985 in light, which barely shows. On touch the rows stay 32 px, below a 44 px hit target.
8. **Keyboard/focus gaps.**
   - Closing the panel drops focus to `<body>`.
   - Escape doesn't close the desktop panel.
   - From the Workspace toggle it takes the whole conversation's tab stops to reach the panel.
   - Opening with S leaves focus where it was.
   - **Bug:** the `d` theme hotkey fires while typing in the Workspace editor, because it reads `event.target` across the shadow root (apps/web/components/theme-provider.tsx:41–59). Every `d` typed in the editor flips light/dark.
9. **Bug: Rename from the row menu silently fails** after you have opened and closed *another* row's menu (Escape or click-away). "Rename" is chosen and nothing happens. Reproduced 2/2 in headless Chromium: fresh ✓, same row ✓, other row + Escape ✗, other row + click-away ✗, other row + Pin ✓. The likely cause is the menu's focus return blurring the auto-focused `RenameInput`, whose `onBlur` then commits "no change" (rename-input.tsx:55).
10. **The stacked panel layout is cramped.** Below a 512 px panel width (`@lg`), the list stacks above the main area with the list capped at 16 rem. At 280 px the tree shows 2–4 rows and the Artifacts list is clipped (`overflow-hidden`), and the editor card still keeps its full frame. A 900 px viewport always lands here: 256 sidebar + 360 conversation minimum leaves about 284 px for the panel. See `real-desktop-*-viewport-900-sidebar-and-panel.png` and `demo-desktop-*-panel-min-width-280-stacked.png`.

---

## 1. Workspace panel: chrome inventory

### 1.1 DOM hierarchy (desktop, panel open, file selected)

`+` paints chrome. Lines are file:line in `packages/*/src`.

| # | Element | Chrome | Source |
|---|---|---|---|
| 0 | `ResizableHandle` (between conversation and panel) | 1 px `bg-border` line; `after:` 4 px hit area; no hover style | ui/components/resizable.tsx:40 |
| 1 | `<aside aria-label="Side panel">` | `bg-background` (same as page) | chat-ui/shell/app-shell.tsx:154-156 |
| 2 | `RightPanel` root | none | chat-ui/shell/right-panel.tsx:20 |
| 2a | **+ Title bar** "Workspace" + Close | `h-12 border-b px-3`, `text-sm font-medium` | right-panel.tsx:21-34 |
| 3 | `<section aria-label="Workspace">` | `bg-background` again (redundant) | workspace/workspace-panel.tsx:223-227 |
| 3a | + failed-start `Alert` (conditional) | `m-2 rounded-lg border` destructive | workspace-panel.tsx:235 |
| 3b | + notice (conditional) | `border-b px-3 py-2` | workspace-panel.tsx:259 |
| 4 | grid (list / main) | `@lg:grid-cols-[12rem_1fr]`, else rows `[16rem_1fr]` | workspace-panel.tsx:263 |
| 5 | **+ list `<nav>`** | `@lg:border-e` / `border-b`, `p-2 gap-3` | workspace-panel.tsx:377 |
| 5a | Preview item | `rounded-md px-2 py-1.5`, current = `bg-muted` | workspace-panel.tsx:320-327 |
| 5b | "Files" h3 + New file + ⋯ | `text-xs muted`; `icon-xs` (24 px) buttons | workspace-panel.tsx:390-405 |
| 5c | `FileTree` wrapper | `rounded-lg border bg-sidebar` overridden to `rounded-md border-0 bg-transparent` | code-ui/file-tree.tsx:156 + workspace-panel.tsx:502 |
| 5d | **+ `file-tree-container`** (shadow host) | own background from `themeToTreeStyles(createCodeTheme)`, lab(98.26) light; rounded | code-ui/theme/host-styles.ts:50-66 |
| 5e | + selected row | fill `--trees-bg-muted` + **outline** `--trees-selected-focused-border-color: var(--ring)` | host-styles.ts:54,62 |
| 5f | + indent guides | 1 px `border-l` per nesting level | @pierre/trees |
| 5g | "Artifacts" h3 + list | `max-h-[40%] overflow-auto`; "None yet" | workspace-panel.tsx:412-432 |
| 6 | main scroller | `min-h-0 overflow-auto` | workspace-panel.tsx:273 |

The main area differs by view.

**Code file** (`FileView` → `CodeEditor`):

| # | Element | Chrome | Source |
|---|---|---|---|
| 7 | FileView wrapper | `p-2 gap-2` (8 px gutter) | workspace/file-view.tsx:158 |
| 8 | **+ CodeEditor card** | `rounded-lg border bg-background` | code-ui/code-editor.tsx:137 |
| 9 | **+ CodeHeader** | `min-h-10 border-b bg-muted/40 px-3 py-1.5`; file icon, path, Saved, Delete | code-ui/code-header.tsx:30 |
| 10 | `diffs-container` | code surface (diffs theme bg) | code-editor.tsx:146 |

**Markdown / HTML in Code mode** add, inside the CodeHeader:

| # | Element | Chrome | Source |
|---|---|---|---|
| 9a | **+ ToggleGroup** Preview/Code | `variant="outline"`, bordered segmented, h-7 | workspace/rendered-file.tsx:58-66 |

**Markdown rendered**:

| # | Element | Chrome | Source |
|---|---|---|---|
| 7 | wrapper | `p-2` | rendered-file.tsx:168 |
| 8 | **+ card** | `rounded-lg border bg-background` | rendered-file.tsx:169 |
| 9 | **+ CodeHeader** + outlined toggle | as above | rendered-file.tsx:170 |
| 10 | `<article>` | `px-6 py-5` | rendered-file.tsx:171 |

**Preview / HTML rendered** (`BrowserView`):

| # | Element | Chrome | Source |
|---|---|---|---|
| 7 | **+ toolbar** | `min-h-10 border-b bg-muted/40 px-2 py-1.5` | workspace/preview.tsx:120 |
| 7a | + address `InputGroup` | `h-7 rounded-lg border bg-background` + addon "Static render" / `:port` | preview.tsx:247; ui/input-group.tsx:15 |
| 7b | Mobile `Toggle`; external link; (HTML file) **+ outlined Preview/Code toggle** | — | preview.tsx:157-182 |
| 8 | **+ canvas** | `bg-muted/30` | preview.tsx:184 |
| 9 | **+ page** | `bg-background` (+ `border-x`, `max-w-[390px]` in Mobile) | preview.tsx:185-189 |
| 10 | iframe | `bg-background` | preview.tsx:428-435, 554-562 |

**Artifact** (`ArtifactView`):

| # | Element | Chrome | Source |
|---|---|---|---|
| 7 | **+ title row** | `border-b px-3 py-2`: title, version ‹ v1 of 1 › | artifacts/artifact-view.tsx:192 |
| 8 | **+ tabs row** | `border-b px-3 py-1.5`, `TabsList variant="line"` | artifact-view.tsx:230-231 |
| 9 | scroller | `p-3` (12 px gutter) | artifact-view.tsx:245 |
| 10 | **+ iframe** | `rounded-lg border bg-background min-h-80` | artifacts/artifact-preview.tsx:104, 225 |
| 10′ | **+ Code tab** | CodeView `rounded-lg border` + **CodeHeader** `border-b bg-muted/40` | code-ui/code-view.tsx:75, 79 |
| 10″ | Changes tab | DiffView (own header and frame) | code-ui/diff-view.tsx |

The narrow screen wraps all of this in a `Drawer` sheet: `h-[85dvh]`, `border-t`, 14 px top radius, swipe handle, plus the same "Workspace" title bar (app-shell.tsx:184-199).

### 1.2 Nesting depth and border counts

**Framed levels** count the boxes that have their own border *or* their own surface, from the panel edge to the content. **Borders** count the elements drawing a visible border inside the panel, measured by the census (`.context/tmp/census.json`). Tree indent guides are excluded, and the resize handle outside the panel is not counted.

| View (desktop, 560 px panel) | Framed levels to content | Header strips stacked above content | Borders inside panel | Extra surfaces (bg ≠ parent) |
|---|---|---|---|---|
| Nothing selected ("Select a file…") | 1 (tree slab) | 1 (Workspace) | 2 (title `b`, list `e`) | tree slab |
| Code file | **3**: panel → card → header strip | **2** (48 + 41 px) | **4**: title, list, card (4 sides), CodeHeader `b` | tree slab, selected row, header tint |
| Markdown rendered | **3** | **2** | **6** (+ 2 toggle buttons) | + toggle fill, header tint |
| Preview (server/static render) | **3**: toolbar tint → canvas tint → page | **2** (48 + 41 px) | **4**: title, list, toolbar `b`, address group | toolbar `muted/40`, canvas `muted/30`, page `background` |
| HTML file rendered | 3 | 2 | **6** (+ outlined toggle) | as Preview |
| Artifact preview | **2**: gutter → framed iframe | **3** (48 + 41 + 45 px) | **5**: title, list, title row, tabs row, iframe (4 sides) | active-tab shadow |
| Artifact code | **3**: card → header strip → code | **4** (48 + 41 + 45 + 40 = 174 px) | **6** | header tint |

The file name is shown twice in the artifact code view: the title row, then the CodeHeader. Dark mode has the same structure; `border` resolves to white/10 %, so the frames read as outlined cards.

### 1.3 Redundant wrappers and headers

- `RightPanel` title bar and `section aria-label="Workspace"` name the same thing. The header toggle is also labelled "Workspace". The bar only carries a title and Close; Close could live in the list header.
- `aside` (app-shell.tsx:156), `section` (workspace-panel.tsx:226) and `CodeEditor` (code-editor.tsx:137) all paint `bg-background` over the same background.
- `FileTree` ships a card (`rounded-lg border bg-sidebar`) that the workspace then undoes with overrides (workspace-panel.tsx:502). The host theme background still leaks through as a slab.
- CodeHeader inside the editor card duplicates the path, which the tree selection already shows. In artifacts it duplicates the title row.
- The artifact title row and the tabs row are two bars that could be one. The version pager plus three tabs fit on one line at 368 px.
- `BrowserView` stacks toolbar tint + canvas tint + page. The canvas tint is only visible in Mobile width mode.
- Gutters differ by view: `p-2` for files, `p-3` for artifacts, `0` for the browser. Each view therefore starts at a different inset.

### 1.4 File search today

| Where | What exists | Evidence |
|---|---|---|
| Workspace panel | **None.** `search={false}`; library type-to-search off; typing a letter on a focused tree row does nothing (keyboard probe: `searchInputs: 0`) | workspace-panel.tsx:506; keyboard.json |
| `FileTree` (code-ui) | Our own `TreeSearch`: a `border-b` row with a search icon and `input[type=search]`. Uses `useFileTreeSearch`. Enter/Shift+Enter walk matches, Escape closes. The library's default mode `expand-matches` hides nothing | code-ui/file-tree.tsx:161, 172-216 |
| Where it's on | `/dev/code` demo; library skill form | apps/web/app/dev/code/demo.tsx:120; library-ui/components/skill-form.tsx:191 |
| @pierre/trees | Also supports `search: true` (built-in input, printable key opens search), `fileTreeSearchMode` `expand-matches` \| `collapse-non-matches` \| `hide-non-matches`, `searchBlurBehavior` | node_modules/@pierre/trees/dist/model/publicTypes.d.ts:59-131; render/FileTreeView.js:207, 1086 |
| Chat-level | ⌘K palette ("Search" in the sidebar) searches chats, not files. `@` in the composer mentions files. The `file_search` tool is RAG, not UI | shortcuts/registry.ts:49 |

Screenshots: `devcode-*-filetree-search-idle|results-ts|no-results.png`. With the search on, it adds one more bordered row inside the tree card. On a "no results" search the tree simply goes empty, with no message.

### 1.5 States per view

| View | Empty | Loading | Error | Screenshot |
|---|---|---|---|---|
| Panel (files off) | "Files are turned off on this server." (list) + "Sandboxes are turned off…" (main) | — | — | code only (workspace-panel.tsx:474, 752) |
| Workspace start | "No files yet. Files you and the agent create will appear here." (new chat) / "…Ask for one, drop a file here, or type /new-file" + New file button | "Starting the workspace…", "Loading files…" (xs text in list, `role=status`) | Destructive `Alert` "The workspace didn't start" + Retry (`m-2`); `notice` bar `border-b` | `real-desktop-*-workspace-new-chat-empty.png` |
| Nothing selected | "Select a file to open it." | — | — | `demo-desktop-*-workspace-select-a-file.png` |
| File | — | Skeleton (h-6 w-40 + h-64) | `p-4 text-destructive`; save error line; conflict `Alert` Reload/Overwrite; binary notice; "Read-only: over 1 MB" | code: file-view.tsx:121-185 |
| Preview | "Nothing to preview yet. Pages the agent writes…"; "There's nothing to show at …" | Spinner "Connecting to port N…", "Rendering {file}…" | "Nothing is running on port N yet…" + Retry; "There's no {file} in the workspace."; address refusal via `aria-invalid` + `title` only | `real-desktop-*-workspace-preview-static-render.png` |
| Artifacts | "No artifacts yet. Code, pages and documents…" (+ list "None yet") | Skeleton | `p-3 text-destructive`; runtime error box `rounded-lg border border-destructive/30`; "runtime isn't responding" text | `real-desktop-*-workspace-artifacts-empty.png`; `demo-desktop-*-workspace-artifact-*` |
| Tree search (dev) | Empty tree, no message | — | — | `devcode-*-no-results.png` |

Gaps:

- The loading and empty states in the list are 12 px muted text, while the same states in the main area are 14 px centred with an icon.
- The error treatments are four different styles: Alert, bare red text, a bordered red box, and a `title` tooltip.
- In `/dev/chat` the Preview list item appears, but selecting it shows "Select a file to open it." The demo doesn't pass `workspace.paths`, so `ChatScreen`'s `hasPreview` is false (chat-screen.tsx:374-375). This is a demo-only wiring gap; the real app works.

---

## 2. Sidebar

### 2.1 Measurements (computed, 1440×900, light)

| Property | The app today | Source | ChatGPT (approximate reference, from memory, not measured) |
|---|---|---|---|
| Width | **256 px fixed** (`w-64`) | app-shell.tsx:124 | about 260 px default |
| Resizable | **No** (no handle; only the right panel resizes) | app-shell.tsx:121-129 | Not user-resizable in the main web app as far as I know; some clones allow about 200–400 px |
| Mobile | Drawer sheet, `min(18rem, 85vw)` = 288 px, from the start edge, swipe/Esc/backdrop | app-shell.tsx:167-182 | Full-height overlay, about 80–85 % width |
| Collapse | All-or-nothing; instant; ⌘B and header button; no rail | chat-screen.tsx:278-285, 648-666 | Collapses to a slim rail (icons) on desktop; ⌘⇧S toggles |
| Persistence | `localStorage["chat-ui:layout"].sidebarOpen`; pre-paint script avoids a flash | use-shell-layout.ts:14-54; apps/web/app/(app)/_shared/shell-prepaint.ts; shell.css | Remembered |
| Breakpoint | `< 48rem` (768 px) becomes a sheet; SSR renders wide and CSS `max-md:hidden` covers it | use-narrow-screen.ts:6 | about 768 px |
| Top bar | 48 px (`h-12`), brand `px-3` | chat-sidebar.tsx:100 | about 52–56 px |
| Nav rows (New chat, Search, Library) | 32 px, `px-2`, 14 px/20 px, icon 16 px, Kbd hint at right | chat-sidebar.tsx:36-37 | about 36 px |
| Chat row | **32 px** (`h-8`), `ps-2 pe-8`, 14 px/20 px, weight 400 (active 500), radius 8 px | chat-row.tsx:84 | about 36 px, 14 px, radius about 8–10 px |
| Row pitch | 33 px (`gap-px`) | chat-sidebar.tsx:148 | about 36–38 px |
| Group heading | 12 px / 500 muted, `pt-4 pb-1 px-2` (36 px block) | chat-sidebar.tsx:141-142 | about 12 px, similar |
| Title truncation | `truncate` (ellipsis) inside a text box that always ends 32 px early (`pe-8`) | chat-row.tsx:84, 92 | Fade-out mask at the end; the fade widens on hover to reveal ⋯ |
| Row actions | ⋯ `icon-xs` 24 px, `absolute end-1 top-1`, `opacity-0`, shown on hover/focus-within/open; **always visible on `pointer-coarse`** | chat-row.tsx:99 | Hover-only ⋯ (always on touch) |
| Active row | `bg-sidebar-accent` + font-medium (light: oklch 0.97 on 0.985) | chat-row.tsx:85-86; globals.css:84-88 | Clearer grey fill |
| Hover | same `bg-sidebar-accent` | chat-row.tsx:84 | Lighter than active |
| Account footer | `border-t p-2`, 44 px button (`h-11`) | chat-sidebar.tsx:166; account-menu.tsx | about 52–60 px with avatar + plan |
| Empty | "No chats yet. Start one and it shows up here." | chat-sidebar.tsx:131-133 | — |
| Touch rows | 32 px (below 44 px) | measured in the sheet: `h 32` | about 40–44 px |

### 2.2 Resize implementation (panel only)

- `react-resizable-panels` v4 `Group`/`Panel`/`Separator` via `@workspace/ui/components/resizable`.
- The conversation has `minSize="360px"`. The panel has `defaultSize={panelWidth}px`, `minSize=280px`, `maxSize=960px` and `groupResizeBehavior="preserve-pixel-size"` (app-shell.tsx:130-163; model/layout.ts:24-27).
- Width persists only on a finished user drag (`onLayoutChanged` + `isUserInteraction`), clamped by `clampPanelWidth`.
- Effective max at 1440 px with the sidebar open is **823 px** (the 360 px conversation minimum wins).
- The handle has no `aria-label` and a 1 px visual with a 4 px hit area. It has no hover/active state and no `withHandle` grip.
- Keyboard works: it is a focusable `separator`, and ArrowLeft grew the panel 560 → 619 px (percentage steps).
- Double-click to reset is not configured.
- The sidebar has none of this.

Screenshots:
- `demo-desktop-*-sidebar-expanded(-crop).png`, `…-row-hover-actions-crop`, `…-row-menu-open-crop`, `…-rename-inline-crop`, `…-long-title(-hover)-crop`, `…-sidebar-collapsed`
- `real-desktop-*-sidebar-row-hover-crop`, `real-desktop-*-sidebar-collapsed`, `real-desktop-*-viewport-767-breakpoint`
- `demo-mobile-*-sidebar-sheet-open`, `real-mobile-*-sidebar-sheet`

---

## 3. Keyboard and focus today

Probe: `.context/tmp/keyboard.ts` → `keyboard.json`. Registry: chat-ui/shortcuts/registry.ts:38-50.

| Key / action | Behaviour | Notes |
|---|---|---|
| N / `/` / J K / [ ] / ? | New chat, focus composer, next/prev chat, prev/next branch, shortcut help | Single-key "view" scope; skipped in editable targets, including inside the editor's shadow root (use-shortcuts.ts:40-44) |
| S / A | Toggle panel on Files / Artifacts | Focus is **not** moved into the panel (stays on `body`) |
| ⌘/Ctrl+B | Toggle sidebar (sheet on narrow) | Global; focus unchanged |
| ⌘/Ctrl+K | Palette | Global |
| **D** | **Toggles light/dark (theme-provider.tsx:36-66); not in the registry or `?` help** | **Bug:** it also fires while typing in the Workspace editor. Each `d` flips the theme (probe: new file, type `d` → dark, `d` again → light) because `isTypingTarget(event.target)` sees the shadow host |
| ⌘/Ctrl+S in editor | Save | code-editor.tsx:119-132 |
| Esc | Closes sheets (narrow), menus, dialogs, the rename input, the address bar (resets), tree search (dev) | **Does not close the desktop panel** (probe: still open after Esc) |
| Close panel (×) | Panel closes | **Focus lost to `<body>`**; not returned to the Workspace toggle |
| Tab order | sidebar → header → conversation → composer → panel (DOM order) | From the Workspace toggle it took more than 16 Tabs through the conversation before reaching the panel. No skip link or landmark jump |
| Tree | Arrow keys move (roving, `treeitem`); Enter opens | No type-ahead/search (search off) |
| Resize handle | Tab-focusable; arrows resize | Unlabelled |
| Row actions | Tab reaches each row, then its ⋯ (2 stops per chat) | 11 chats = 22 tab stops |
| Rename | Enter saves, Esc cancels, blur saves | See bug 9 (Rename lost after another row's menu) |
| New file dialog | Name input `autoFocus` | new-file-dialog.tsx:115 |
| Mobile sheets | Modal; focus trapped; Esc/swipe/backdrop close | Base UI Drawer |

---

## 4. Screenshot index (`.context/before/`)

- **Workspace, demo, desktop**
  - `demo-desktop-{light,dark}-workspace-`: `select-a-file`, `file-markdown-rendered`, `file-markdown-code`, `file-code-editor(-crop)`, `new-file-dialog`, `file-html-code`, `file-html-rendered`, `preview(-crop)` (demo gap: shows the select state), `artifact-html-preview|code`, `artifact-react-preview|code` (no runtime, so Code/Changes only), `artifact-markdown-preview`, `artifact-mermaid-preview`
  - `demo-desktop-{light,dark}-panel-`: `resize-handle-hover-crop`, `min-width-280-stacked`, `max-width`
- **Workspace, real app, desktop.** `real-desktop-{light,dark}-`: `workspace-new-chat-empty`, `workspace-preview-static-render`, `workspace-file-code`, `workspace-file-markdown-rendered`, `workspace-file-html-rendered`, `workspace-file-html-code`, `workspace-tree-long-names` (middle-truncated `very-l…tsx`), `workspace-artifacts-empty`, `viewport-900-sidebar-and-panel`, `viewport-767-breakpoint`, `home-new-chat`
- **Mobile.** `demo-mobile-{light,dark}-`: `chat`, `header-overflow-menu`, `sidebar-sheet-open`, `workspace-sheet-select-a-file`, `workspace-sheet-markdown-rendered`, `workspace-sheet-code-editor`, `workspace-sheet-artifact-html`. `real-mobile-{light,dark}-`: `home`, `sidebar-sheet`, `workspace-sheet-preview`, `workspace-sheet-file-code`
- **File search.** `devcode-{light,dark}-filetree-search-idle|results-ts|no-results`
- **Sidebar.** See §2.2.

Not captured: the failed-workspace Alert, the save conflict, "Nothing is running on port N" and the runtime error box. These can't be produced from the demo or the real app without Docker or fault injection. They are listed from code in §1.5.
