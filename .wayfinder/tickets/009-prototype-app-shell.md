---
id: "009"
title: "Prototype: app shell and information architecture"
labels: [wayfinder:prototype]
status: closed
assignee:
blockedBy: []
---

## Question

How should the web app's shell look and behave? This covers the sidebar (chats, library, search),
the `AppHeader` (title + branch switcher, chat context chip, share, sandbox status), settings,
the admin area (org policies, keys, budgets, audit) and the ⌘K palette (`PLAN.md` D14, D17).

**HITL.** Use the `prototype` skill to make something rough Connor can react to. It can be a
throwaway page in `prototypes/` or a standalone artifact, and it doesn't need the scaffold.
Link the prototype from this ticket.

## Done when

Connor has picked a direction; the resolution records it for 015 and 024.

## Resolution (2026-09-27, Connor)

Prototyped three directions (Classic: persistent sidebar; Workspace: icon rail, list panel, breadcrumb, right Sandbox/Artifacts panel, single-key shortcuts; Focus: floating pill + slide-over). **Chosen: Classic + Workspace panels.**
- **Sidebar (Classic):** New chat, Search (⌘K), Library at the top; chats grouped by date (Today / Yesterday / Previous 7 days / Older) with hover rename/pin/archive (undo toast); account menu in the footer (theme, settings, admin, sign out); collapsible with ⌘B.
- **Header (Classic):** sidebar toggle left; title (click to rename) + branch switcher ‹ n/N › centre; right: chat context chip (Personal / team / org, locks with a lock icon after the first message; a team agent pre-selects its team), participants/avatars, Share, sandbox status pill.
- **Right panel (from Workspace):** toggleable Sandbox (terminal log + files) and Artifacts tabs, opened from the sandbox pill or artifacts, resizable, remembers state.
- **Keyboard (from Workspace):** single-key shortcuts when focus isn't in a text field (N new chat, / focus composer, J/K move between chats, [ ] branches, S sandbox panel, A artifacts panel, ⌘B sidebar, ⌘K palette, ? help), with Kbd hints on controls.
- Composer docked at the bottom of the conversation column.

Reference implementation (prototype only, never merged): branch `t/009-prototype-app-shell`, `apps/web/app/prototypes/app-shell/` (`classic.tsx`, `workspace.tsx`, `shared.tsx`, `data.ts`).
