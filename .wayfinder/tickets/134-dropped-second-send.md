---
id: "134"
title: "A second message sent ~0.4s after the first on a new agent chat never reaches the server"
labels: [wayfinder:build]
status: open
assignee:
blockedBy: []
---

## Question

Found while fixing 132. `skills.spec` "an agent lists its skill and loads it with load_skill" failed once: on a new `/?agent=` chat, the second message (sent about 0.4s after the first) never produced a run request; the trace shows none. It passed 5/5 on rerun. This is probably a real client bug: a send during the new chat's creation and navigation is dropped, not queued.

## Done when

- Reproduce with a delayed `POST /conversations` / run response. A send during new-chat creation is queued or blocked visibly, never silently dropped.
- Regression e2e.
