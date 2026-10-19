---
id: "183"
title: "Schedules UI: proposed-schedule card, schedules page, run history, editor"
labels: [wayfinder:build]
status: closed
assignee: claude (t-182 overnight, 2026-10-20)
blockedBy: ["173a", "173"]
---

The research doc calls this ticket 181; that id is the sidebar branch's, so it's 183 here.

## Done when

- **Proposed card:** the Dot's `schedule_task` call renders as a Proposed schedule card: name, task, recurrence in plain words, first run, time zone and when it'll tell you. Approve applies it, Reject dismisses it, and afterwards the card reads Scheduled or Not scheduled.
  - `schedule_task` takes `when` in plain English or as an RRULE, so cheap models can propose one.
- **`/schedules` page:**
  - a usage line ("N of 24 runs used · every 60 minutes or longer");
  - All, Active, Paused and Completed filters, and search;
  - rows reading "Last ran … · Next …", with the reason when paused;
  - Run now, Pause/Resume, Edit, and Delete with a confirmation;
  - a drawer with the run history (outcome badges, skip reasons, "Open in chat", "Show older");
  - an empty state with Daily brief, Follow-up monitor and Weekly review templates.
- **Editor dialog:**
  - a "When" field in plain words, parsed by a pure English parser (no model), with presets and a live read-back plus the first run;
  - inline errors for in the past, unreadable, or below the minimum interval;
  - "Posts to": the Dot, this chat, or a new chat each run;
  - "Tell me": the notify policy;
  - time zone (a searchable list) and End repeat;
  - Save, and Save and run now.
- **Chat header:** "Next run in …" when a task posts into the chat, linking to `/schedules`; otherwise a clock button that schedules a task in this chat. The command palette has "Open scheduled tasks". The Dot profile's Scheduled tab uses the same rows and editor.
- **Transcript:** "Sent by scheduled task · <name>" on the message; "Needs your attention" or "Nothing new" from the report; a quiet run folds into "<name> ran · nothing new".

## Owns

`apps/web/app/(app)/(pages)/schedules/**`, and in `packages/chat-ui/src/conversation/`: `schedule-card.tsx`, `schedule-text.tsx` and `scheduled-note.tsx`, plus the hooks in `tool-part.tsx`, `message-row.tsx` and `conversation-view.tsx`. Also `packages/chat-ui/src/model/{scheduled,parts}.ts` and the `headerExtra` slot on `ConnectedChat`.

## Resolution

Built in `t/182-dots-engine-ux`; covered by pure tests for `parseWhen`, `describeRecurrence` and `quietRuns`.

- **Not built:**
  - "Edit" on the proposed card (edit it on `/schedules` after applying instead).
  - "Create with chat" (seeding the Dot's thread with an interview prompt).
  - Browser-mode tests for the card and editor, and an e2e spec.
  - A sidebar nav entry for Scheduled; t/181 owns the sidebar.
