---
id: "315"
title: "Do approvals expire, and what do we tell you when a run was interrupted?"
labels: [wayfinder:grilling]
status: open
map: "300"
assignee:
blockedBy: []
---

## Question

From [the closed-tab research](303-web-run-survives-closed-tab.md): an approval with nobody watching waits forever and holds its chat's queue, and a deploy or crash ends in-flight runs. Once runs happen while the app is closed, these become normal. Decide: should an approval expire (after how long, to deny or to cancel, configurable per org?); should a nudge push go out before it does; what does the notification say for an interrupted run (offer retry?); and in a shared chat, does everyone who can decide get the approval push, or only whoever started the run?
