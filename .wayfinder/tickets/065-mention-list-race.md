---
id: "065"
title: "@ file list misses files that load after the last keystroke"
labels: [wayfinder:build]
status: open
assignee: loop
blockedBy: []
---

## Question

064 found that the "@hello.md" e2e failed in 5 of 6 runs under load (1 in 3 on unchanged main). The composer's `@` menu
reads `files` only when a key is pressed. If the workspace listing arrives after the last keystroke, the file option never
appears until you type again. The test now retypes as a workaround, but the race is still in the app.

## Done when

- When `files` (or other mention candidates) change while the `@` menu is open, the open menu refilters and shows them
  without another keystroke (`packages/composer`: the suggestion items source reads the latest candidates, and a prop
  change re-renders the open menu).
- `connected-chat.tsx` fetches the file listing early enough that it's usually ready: for example when the composer is
  focused, or when `@` is typed for the first time, and not only once the panel is open.
- A composer browser test opens `@`, then supplies `files` later, and the option appears with no further typing.
- Revert the retype workaround in `e2e/tests/workspace.spec.ts` "@hello.md" and confirm the test passes 5/5 in a row.
- Gate passes; e2e passes.

## Owns

`packages/composer/src/**`, `packages/chat-ui/src/chat/connected-chat.tsx`, `e2e/tests/workspace.spec.ts`.
