# Connor's Zettelkasten: behaviours to translate into openchat

**Source:** the local checkout `/Users/connorforsyth/conductor/workspaces/connor-website/prague` (HEAD 5356476), read-only. Paths below are relative to it. The live site at https://connorforsyth.co/notes matches the code. Connor's own write-up is at https://connorforsyth.co/projects/zettelkasten (`content/projects/zettelkasten.mdx`, cited below as Z.mdx).

The Zettelkasten has none of these: a graph view, stacked panes, a cmdk palette, view-transitions.

## Navigation
- **Arrow keys walk the rows:** ⌥↑/⌥↓ from anywhere, plain ↑/↓ inside the sidebar. Each step opens the item it lands on using `router.replace`, so history doesn't fill up. Source: `components/notes/notes-sidebar.tsx:291-343`.
- **Prefetch:** content loads on hover or when a row is in view, so opening it doesn't wait on the server. Source: `components/notes/note-link.tsx:4-19`.
- **Instant selection:** a row shows as selected on pointer-down, before its content arrives. Source: `components/notes/sidebar-folders.tsx:187-215`.
- **Backlinks:** "Linked from" sits as a quiet muted footer with a border-top. Source: `app/(notes)/notes/[...slug]/page.tsx:81-95`.

## Panels
- **Three surfaces, no top bar.** Page actions portal into one fixed top-right row. Sources: `notes-shell.tsx:470-522`, `header-actions.tsx:7-16`.
- **The collapsed sidebar peeks** on a 20px edge hover or the corner button. It stays open while you type, resize or use a menu, and closes 500ms after the pointer leaves. The page doesn't move. Source: `notes-shell.tsx:61-84,268-311,420-435`.
- **The right panel pushes the page on desktop and overlays it below 768px.** When closed it is `inert` and hidden, so it can't be tabbed into. Docked, it's flush: border-left and `bg-muted/40`. Source: `components/chat/chat-shell.tsx:50-52,102-107,137-147,181-185,411-417`.
- **Mobile drawer:** a scrim, scroll lock, and it closes on navigation. Source: `notes-shell.tsx:344-386`.

## Search
- **Opening it:** "/" focuses the inline sidebar search and selects its text. Single-key shortcuts are guarded, so they don't fire while you're typing or a menu or dialog is open. Source: `notes-sidebar.tsx:224-255,418-451`.
- **Querying:** 150ms debounce, at least 2 characters, the previous request aborted. On a network error the old results stay. Source: `notes-sidebar.tsx:51-112`.
- **Results replace the tree**, with an "N found" / "Nothing found" line. There's one row per match: the first shows the title, the rest show a 2-line snippet, with hits highlighted. Source: `notes-sidebar.tsx:461-498`.
- **Keys:** ↓/↑ wrap around and preview each match in place (`replace`, scrolled to the match) while focus stays in the box. Enter commits. Escape clears and blurs. Source: `notes-sidebar.tsx:138-141,260-289`.
- **Hit highlighting:** every hit is highlighted, the current one at full contrast and centred. The hit colour is distinct from the active-row and authored highlight colours. Sources: `components/notes/search-hit.tsx:7-26`, `styles/globals.css:53-65`, Z.mdx:56-68.

## Resizing
- **Left sidebar:** 200–420px, default 256px. Width, collapsed state and folded folders are saved in a cookie, so the server renders them with no flash. Sources: `lib/notes/sidebar-state.ts:1-10`, Z.mdx:52.
- **Handle:** an 8px hit strip showing a 1px line on hover (`foreground/40`, `/60` while dragging). It uses pointer capture, saves on release (not on every pixel), and turns off text selection while dragging. Double-click resets; ←/→ nudge by 16px. Source: `notes-shell.tsx:191-266,403`.
- **Right panel:** 340–720px, default 400px, and the page keeps at least 480px. Width is saved in localStorage. The handle is a hand-written WAI-ARIA separator, not react-resizable-panels, because that library takes over scrolling. Its pill shows only on hover or focus. ←/→ step 24px, Home/End jump to the limits, double-click resets. Sources: `chat-shell.tsx:41-46,97-98`, `components/chat/resize-handle.tsx:21-111`.

## Focus
- **"[" toggles the sidebar** (the tooltip shows the key). Escape closes one layer at a time. Source: `notes-shell.tsx:148-189`.
- **Closing a panel returns focus to its trigger** when focus was inside the panel or on `<body>`. Source: `chat-shell.tsx:253-262,309-320`.
- **Shortcut hints** appear in the sidebar footer only on devices with a keyboard. Source: `notes-sidebar.tsx:513-542`.
- **Inline rename:** Enter or blur commits, Escape cancels. Source: `sidebar-folders.tsx:109-158`.

## Motion
- **Drawer and peek:** a 200ms ease-out transform. The docked column doesn't animate. Source: `notes-shell.tsx:70-83`.
- **Keyboard toggles don't animate.** The icon transition is 160ms `cubic-bezier(0.77,0,0.175,1)`, with motion-reduce respected. Sources: `packages/ui/src/components/sidebar.tsx:136-151`, `notes-shell.tsx:137,182`.
- **One spring drives the panel, its frame and the page push** (damping 47 / stiffness 680, about 280ms, no overshoot), and it can reverse mid-flight. Reduced motion jumps straight to the end. Source: `chat-shell.tsx:83-95,228-240`.
- **Row "⋯"** fades in on hover or focus. Source: `sidebar.tsx:114`.

## Density
- **Rows:** 28px desktop, 44px touch, `rounded-md`. Hover is `foreground/5`; the active row is `foreground/8` plus `font-medium`. Icons are 16px and muted. Source: `sidebar.tsx:24-39`.
- **Folders:** muted `text-sm`, indented 0.875rem per level. Actions appear only on hover. Source: `sidebar-folders.tsx:65-80,486-497`.
- **Row menus:** right-click, long-press and ⋯ open the same menu. Source: `sidebar.tsx:63-134`.
- **Surfaces:** sidebar `bg-muted/40` with a border-right; page `bg-background` with generous top padding; a single small type scale. Sources: `notes-shell.tsx:83,518-521`, Z.mdx:44.

## Connor's stated preferences
- **Linear-shaped rather than stock shadcn:** the stock sidebar "stopped being the right thing" (Z.mdx:52).
- **Optimistic UI:** "Assume the write lands, show it at once" (Z.mdx:118). "A write that lands is not news", so the "Saving…" indicator was removed and only failures speak (commit 5b634b1).
- **Refuse before, not after:** a refusal after the fact is "a small haunting" (Z.mdx:120).
- **Cut menus that only repeat existing actions** (Z.mdx:46). "Every version that felt complicated was one that answered two questions in one control" (Z.mdx:134).
- **Subtract on touch** rather than shrink, and never offer a mode you can get stuck in (`packages/ui/design/principles.md:29-31`).
- **Test on a real iPhone:** work that was buggy on an iPhone was reverted (commits 1c7e5bf, 6a7e52c, 0d1cca9).
