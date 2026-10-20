---
id: "174"
title: "One Dot per user: the Dot is a thread"
labels: [wayfinder:build]
status: closed
assignee: claude (t-182 overnight, 2026-10-20)
blockedBy: ["172"]
---

## Done when

- A second Dot is refused with `CONFLICT` (`already_exists`). A unique index on `dot.owner_id` enforces this, and the insert is race-safe.
- **Migration:** each owner keeps their primary Dot, or else the oldest. Each extra Dot's chat stays as an ordinary chat, and its schedules carry on as schedules on that chat.
- The multi-Dot list, "New Dot" and the primary picker ("Make primary") are gone. `/dots` forwards to the Dot's thread, or shows onboarding when there's none.
- The sidebar gets what it needs from existing queries:
  - the pinned Dot: `dots.list` returns at most one;
  - `unread`, `unreadRuns` (notified runs only) and `attention` for "Needs attention";
  - `nextRunAt` on the Dot;
  - `Conversation.schedule` for "Next run" on a row.
- ⌘⇧D opens your Dot (`dot.open` in `packages/shortcuts`). ⌘., which ChatGPT uses, is already `model.switch`.

## Owns

`apps/web/app/(app)/(pages)/dots/**` (excluding `sidebar-dots.tsx`, which t/181 owns), `packages/server/src/dots/service.ts`, the `dot_owner_uidx` migration, and `packages/shortcuts/src/{ids,registry}.ts`.

## Resolution

Built in `t/182-dots-engine-ux`; covered by service tests for uniqueness and a shortcut registry test.

- **Not built here:** the sidebar's top slot, its preview tooltip, and hiding the Dot from Recents (`hideDotFromRecents`). Those belong to the sidebar ticket (t/181). The data is all exposed.
