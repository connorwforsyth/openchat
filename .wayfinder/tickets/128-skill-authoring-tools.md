---
id: "128"
title: "Create, edit and publish skills from a chat (tools)"
labels: [wayfinder:build]
status: open
assignee:
blockedBy: ["127"]
---

## Question

Connor (2026-10-02): "we also will need like a create skill tool / edit etc. and publish .. from there." The model should be able to write a skill with the person in a chat, revise it, and publish it to the Library.

## Done when

- **Registry tools:**
  - `create_skill`: name, description, `SKILL.md` body, optional files. Creates a **draft** library item owned by the person.
  - `update_skill`: creates a new draft version. It only works on skills the person can edit.
  - `publish_skill`: publishes a version through the existing library publishing path (`packages/server/src/library/publishing.ts`), with the same permission checks as the Library UI.
- **Approvals:** create and update use `approval: "ask"`, like artifacts. Publish always asks and shows where it will be published (personal or org). No new permission policy; it reuses today's library rules (any policy change is a proposal).
- **Chat UI:** a skill card in the transcript shows the name, version, draft or published state, and "Open in Library"; the edit diff uses the same text diff as artifacts.
- **After saving:** a newly created skill can immediately be picked from + or `/` (127).
- **Tests:** unit tests for the tools (permission refusals return model-fixable errors); e2e covering create, then edit, then publish with approval, then the skill appears in the + menu; an eval case.

## Owns

`packages/ai/src/tools/registry/*skill*`, `packages/server/src/library/**` (tool ports only), the chat-ui skill card, e2e/evals.
