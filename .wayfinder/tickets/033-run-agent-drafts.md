---
id: "033"
title: "Builder test chat runs the draft; test chats stay out of history"
labels: [wayfinder:build]
status: open
assignee:
blockedBy: ["017"]
---

## Question

The Agent Builder's test chat runs the draft's model/settings but not its instructions or tools,
because runs only accept published versions. Let editors (edit grant) run the **draft**: the turn
resolver accepts a draft reference when the caller can edit the agent; runs record that they used
a draft. Test-chat conversations get a `purpose: test` (or equivalent existing field) so they're
hidden from chat history and search, and are cleaned up after a while. If this needs a contract
change, make it a separate contract PR and flag it in `QUESTIONS-FOR-CONNOR.md`.

## Owns

`packages/server` (turn resolver, runs), `packages/library-ui` (test chat), `packages/db` (additive).

## Done when

Editing instructions in the builder changes the test chat's behaviour immediately (mock-model test);
test chats don't appear in history or search.
