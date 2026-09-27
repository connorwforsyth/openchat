---
id: "033"
title: "Builder test chat runs the draft; test chats stay out of history"
labels: [wayfinder:build]
status: closed
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

## Resolution (2026-09-27, loop)

Merged in [PR #27](https://github.com/connorwforsyth/openchat/pull/27): editors can run an agent's draft (use-only callers get NOT_FOUND; the turn resolver and approvals re-check edit for drafts, use for published versions); the builder's test chat runs the stored draft; `conversation.purpose = test` hides test chats from list/search and a job prunes them after 24 h; `run.agent_draft` records draft runs. No contract change.
