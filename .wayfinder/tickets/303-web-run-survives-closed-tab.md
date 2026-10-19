---
id: "303"
title: "Does a web run really carry on, end to end, when the tab is closed?"
labels: [wayfinder:research]
status: closed
map: "300"
assignee:
blockedBy: []
---

## Question

D4 says closing the tab doesn't stop a run. Check it in code and, where cheap, with the existing e2e harness: a run started then abandoned finishes and settles into the message; an approval raised with nobody watching waits (for how long? is there a timeout that fails it?); reopening resumes from the cursor; queued follow-ups proceed; what `recover()` at boot does to it. List the gaps between that and "notify me when it's done", and where a notification hook would sit (run settled, awaiting_approval).

Findings: `.context/research/ios/web-run-detached.md`.

## Resolution (2026-10-20, research agent)

Yes: a web run carries on with the tab closed. It settles into the message and anything queued behind it runs. Reopening the chat replays the stream from the start (only in-tab reconnects use the cursor); stream chunks are pruned 600 s after a run settles, after which the stored message is the source of truth. Approvals wait forever with nobody watching and survive restarts; a decision, Stop, or a new message on that branch ends the wait. At boot `recover()` fails runs a crash left mid-answer and leaves approval waits alone. A run that hits its time limit probably ends `cancelled`, like a shutdown (untested).

**Gaps:** nothing notifies anyone; there's no "awaiting approval" hook; a forgotten approval holds its branch's queue until someone acts; deploys and crashes end runs, so a notification needs an "interrupted" variant; there's no cross-chat "what needs me" query; in shared chats everyone who can decide (`effectiveGrants`) may need the approval push. **Hooks:** "done" goes in `afterRun` (`services.ts:158`) and queues a job; "needs approval" is a new `onAwaitingApproval` in `settle` (`executor.ts:635-642`). Detail: `.context/research/ios/web-run-detached.md`.
