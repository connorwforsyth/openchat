---
id: "177"
title: "Sidebar list polish (sort, paging, rows, keyboard)"
labels: [wayfinder:build]
status: closed
assignee: loop
blockedBy: []
---

## Question

From the study (B1.8, B3, B4; ideas 6–8): sort menu, "Show more" paging, `content-visibility` rows, scroll-edge fades, quiet row actions and ChatGPT's keyboard set.

## Done when

- a sort menu offers Last updated (with date groups) and Created, persisted per user in localStorage;
- the list renders 50 rows, then a "Show more" button;
- rows use `content-visibility:auto` with an intrinsic block size;
- the scroll area has top and bottom fade masks (an opacity gradient);
- the row action slot takes no width until hover or focus-within;
- the shortcuts ⇧⌘O, ⇧⌘A, ⌥⌘P, ⇧⌘[ / ⇧⌘], ⇧⌘S (alias for ⌘B) and ⌘/ are registered and shown in the `?` dialog;
- ⌘Z undoes the last archive (a toast with Undo).
- **Tests:** browser-mode tests for sort, paging and the keyboard paths; registry conflict tests.

## Owns

`packages/chat-ui/src/sidebar/**`, `packages/chat-ui/src/model/{date-groups,sidebar-list}.ts`, `packages/shortcuts/src/{ids,registry}.ts`.

## Resolution (2026-10-20, branch t/181-sidebar-ux)

Pure `model/sidebar-list.ts` (`buildSidebarList`, `visibleOrder`); sort menu (Last updated with date headings, Created flat) saved in localStorage; 50 rows then Show more / Show less; `content-visibility:auto` rows with an intrinsic block size; scroll-edge fade masks set from scroll without re-rendering; the ⋯ slot stays overlaid on the title fade. Registry (`packages/shortcuts`): ⇧⌘O new chat, ⇧⌘S sidebar, ⌘/ help, ⇧⌘A archive, ⌥⌘P pin, ⇧⌘U unread, ⇧⌘[ / ⇧⌘], ⌥⌘A, ⇧Esc, ⌘. Dot; Switch model moved to ⇧⌘. (QUESTIONS #2). ⌘Z undoes the last archive while its toast is up. The desktop menu lists the new ids in `OFF_MENU`. Not done: ⌃Tab MRU (browser-reserved).
