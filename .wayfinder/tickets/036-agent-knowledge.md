---
id: "036"
title: "Agent knowledge files feed file_search in turns"
labels: [wayfinder:build]
status: open
assignee: loop
blockedBy: ["017"]
---

## Question

Found by 033: the turn resolver doesn't use an agent version's **knowledge files** yet (drafts or
published), so an agent can't search its own documents. Wire it: when a turn runs an agent with
knowledge files, add the `file_search` tool (021) scoped to those files plus any files attached in
the conversation, gated by the Decider's retrieval gate (D15), with grant checks (a `use` grant lets
the agent search its knowledge on the user's behalf without exposing the raw files). Citations come
back as `source` parts via `toolSources()` (021's note for 014).

## Owns

`packages/server/src/runs/` (turn resolver tool assembly), `packages/ai/src/rag/` (scoping), tests.

## Done when

A mock-model run of an agent with a knowledge PDF calls `file_search`, gets the right chunk, and the
answer carries a citation; a user with only `use` can't download the file directly.
