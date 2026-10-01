---
id: "109"
title: "Answers record their agent, and their model as soon as they start"
labels: [wayfinder:build]
status: open
assignee:
blockedBy: []
---

## Question

Found by 107 (model/agent markers): `claim` in `packages/server/src/runs/executor.ts` creates the assistant message without `agent`, and `updateMessage` (`packages/db/src/queries/messages.ts`) can't set one. So `message.agent` is always null on real answers: agent markers and feedback's `canShare` never apply. The resolved `model` is only written when the answer finishes, so a model marker appears late.

## Done when

- The assistant message gets `agent` (the agent version ref) and the resolved `model` when the run is claimed or resolved, before the first token. Settle doesn't clear them.
- Existing rows are left as they are (no backfill).
- Tests at the run level, plus 107's e2e extended with an agent switch in a real chat. Gate and e2e pass. No `packages/contract` change.

## Owns

`packages/server/src/runs/executor.ts` (claim and settle), `packages/db/src/queries/messages.ts`, tests, `e2e/tests/chat-markers.spec.ts`.
