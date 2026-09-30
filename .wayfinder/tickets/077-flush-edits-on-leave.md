---
id: "077"
title: "Don't lose an edit typed just before a reload or close"
labels: [wayfinder:build]
status: open
assignee: loop
blockedBy: ["070"]
---

## Question

070 found that the Workspace editor autosaves 800 ms after typing stops, so a reload or tab close within that window
loses the edit. An untouched file also says "Saved", so the state is ambiguous.

## Done when

- **Flush on leave.** A pending edit is flushed on `pagehide`/`visibilitychange` (hidden). Use a keepalive request
  (`fetch(..., { keepalive: true })` through the existing client, if it allows, or a small dedicated path). If the
  page is unloading with unsaved changes the flush can't guarantee, warn with `beforeunload`.
- **Honest state.** The status shows "Unsaved" while dirty, "Saving…" only during a slow save (over about 1 s, per
  Connor's "a write that lands is not news"), and nothing (or a quiet "Saved") once saved. Only failures speak.
- **Tests.** A unit test for the flush and the state machine, and an e2e test: type, reload immediately, and the edit
  persists.
- Gate and e2e pass.

## Owns

`packages/chat-ui/src/workspace/**` (the editor save path only: `model/editor.ts`, `use-open-file.ts`), tests.
