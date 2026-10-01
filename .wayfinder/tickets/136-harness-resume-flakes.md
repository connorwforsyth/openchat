---
id: "136"
title: "Harness e2e flakes under load: a second tab keeps its card after Stop; a card stays after approving across a reload"
labels: [wayfinder:build]
status: open
assignee:
blockedBy: []
---

## Question

Found while fixing 133. Two `e2e/tests/harness.spec.ts` tests fail intermittently under load, at the same rate with and without 133's fix:
- "Stop while a change waits…": the second tab keeps its approval card (around line 279).
- "a reload mid-run or during a pause…": the `script.js` card stays after approving.

These look like stream/resume state problems in chat-ui (`packages/chat-ui/src/chat/connected-chat.tsx`): a card isn't cleared when another tab or a resume settles it. They may be real UI bugs on slow connections.

## Done when

- Root cause found by reproducing with delayed SSE or resume responses.
- A fix plus a regression test. `harness.spec.ts` passes 20/20 with `--workers=4` under load.
