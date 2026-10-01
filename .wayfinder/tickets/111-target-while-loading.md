---
id: "111"
title: "A message never goes out with a model guessed while the chat loads"
labels: [wayfinder:build]
status: closed
assignee:
blockedBy: []
---

## Question

After the 2026-10-01 merges, the workspace e2e failed about one run in ten. A reopened chat sent the picker's placeholder target `auto` before its details loaded, and on an instance with auto off (Connor's, and e2e) the server answered "No model is available in this chat".

## Resolution (2026-10-01, loop)

`messageTarget` sends no target until one is known, and the server then uses the chat's own default. Verified with the workspace spec at 135/135 over 12 repetitions, gate 85/85, and full e2e 69/69. [PR #87](https://github.com/connorwforsyth/openchat/pull/87).
