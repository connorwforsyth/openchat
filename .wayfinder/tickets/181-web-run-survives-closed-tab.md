---
id: "181"
title: "Does a web run really carry on, end to end, when the tab is closed?"
labels: [wayfinder:research]
status: open
map: "179"
assignee:
blockedBy: []
---

## Question

D4 says closing the tab doesn't stop a run. Check it in code and, where cheap, with the existing e2e harness: a run started then abandoned finishes and settles into the message; an approval raised with nobody watching waits (for how long? is there a timeout that fails it?); reopening resumes from the cursor; queued follow-ups proceed; what `recover()` at boot does to it. List the gaps between that and "notify me when it's done", and where a notification hook would sit (run settled, awaiting_approval).

Findings: `.context/research/ios/web-run-detached.md` on branch `research/ios-web-run-detached`.
