---
id: "181"
title: "Does a web run really carry on, end to end, when the tab is closed?"
labels: [wayfinder:research]
status: closed
map: "179"
assignee:
blockedBy: []
---

## Question

D4 says closing the tab doesn't stop a run. Check it in code and, where cheap, with the existing e2e harness: a run started then abandoned finishes and settles into the message; an approval raised with nobody watching waits (for how long? is there a timeout that fails it?); reopening resumes from the cursor; queued follow-ups proceed; what `recover()` at boot does to it. List the gaps between that and "notify me when it's done", and where a notification hook would sit (run settled, awaiting_approval).

Findings: `.context/research/ios/web-run-detached.md` on branch `research/ios-web-run-detached`.

## Resolution (2026-10-20, research agent)

Yes: a web run carries on with the tab closed. It settles into the message, its queued follow-ups run, and reopening resumes from the cursor. Approvals wait forever with no watcher and survive restarts; `recover()` fails runs a crash left mid-answer and leaves approval waits alone. **Gaps:** no notifications at all; no "awaiting approval" hook; a forgotten approval blocks its chat's queue indefinitely; deploys and crashes end runs, so a notification needs an "interrupted" variant; no cross-chat "what needs me" query; approvals in shared chats should notify everyone who can decide (`effectiveGrants`). **Hooks:** "done" goes in `afterRun` (`services.ts:158`) and queues a job; "needs approval" is a new `onAwaitingApproval` in `settle` (`executor.ts:635-642`). Detail: `.context/research/ios/web-run-detached.md` on branch `research/ios-web-run-detached`.
