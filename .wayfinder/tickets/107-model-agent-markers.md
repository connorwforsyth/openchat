---
id: "107"
title: "A marker in the chat where the model or agent changes"
labels: [wayfinder:build]
status: open
assignee: loop
blockedBy: ["099"]
---

## Question

Connor (2026-10-01): when you switch models in a chat, show a marker in the conversation; the same when switching agents. Each message already records `model` (the resolved ref) and `agent` (`packages/contract/src/schemas/messages.ts`), so this is client-only.

## Done when

- **Where a marker appears:** on the active path, before an assistant message whose `model` or `agent` differs from the previous assistant message's. The first reply has no marker.
- **What it looks like:** a quiet centred divider: a hairline, the brand mark (099's `BrandMark`, letter fallback) and the display name ("Claude Opus 5"), or the agent's name and icon. If both changed, the agent wins and the model shows muted after it.
- **Name lookup:** from the model list (`displayName`), falling back to a tidied ref. Agents come from the library; deleted ones show "Removed agent".
- **Accessibility:** a separator with a label ("Switched to Claude Opus 5"); excluded from copy-all; never a message.
- **Branches:** the markers follow the branch you're viewing.
- **Tests:** markers at changes only, agent and model cases, branch switching, and an e2e test that switches model mid-chat and sees one marker. Gate and e2e pass. No `packages/contract` change.

## Owns

`packages/chat-ui/src/conversation/**`, `packages/i18n/locales/**`, `e2e/tests/chat*.spec.ts`.

## Results (2026-10-01, loop)

- **Built.** `answerSwitches` (`packages/chat-ui/src/conversation/switches.ts`, pure) walks the shown branch and returns, per answer, what changed since the answer before it; `SwitchMarker` (`switch-marker.tsx`) draws it; `ConversationView` puts the marker at the top of that answer's scroller item, outside the message. Unselectable (`select-none`), Base UI `Separator` with `aria-label` ("Switched to Parrot", "Switched to Release helper with GPT-5"); not a message, no actions.
- **The rule.** Only assistant messages with a stored `model` count. A marker shows before an answer when the previous counted answer on the active path had a different `model` or a different agent **item** (a new version of the same agent is no switch). The first answer never has one. Agent changed to an agent: the agent's name and icon (an emoji `icon`, else `AgentIcon`), plus the new model muted after it if the model changed too. Agent → no agent, or model only: the model's mark (`ModelSelectorLogo`, letter fallback) and display name. An answer with no `model` yet (the live tail while streaming) neither shows a marker nor moves the baseline.
- **Names.** Model: the list's option whose `selector`, else `target`, is the ref → `modelName` (its `displayName`); otherwise `tidyModelName` of the ref, vendor from `vendorOf`. Agent: the composer's agent list by id; not there → "Removed agent".
- **Outside Owns (small, needed for wiring):** `chat/chat-screen.tsx` passes `composer.models`/`composer.agents` to the view; `model/live-messages.ts` keeps the stored `agent`/`model` on the streaming copy; `packages/ai/package.json` exports `./providers/describe` (for `tidyModelName`, `vendorOf`, the picker's own naming). No `packages/contract` change, no new dependency.
- **Found:** the server never stores an answer's agent. `executor.ts` `claim` inserts the answer without `agent`, and `updateMessage` can't set one, so `message.agent` is always `null` on real answers (only a fork copy carries it). Agent markers therefore show only once that's fixed (a server/db change, outside this ticket). Also `message.agent_id` is `onDelete: set null`, so a hard-deleted agent comes back as no agent (a model marker), not "Removed agent"; "Removed agent" shows for an agent the viewer can no longer use. And `model` is written when the answer settles, so a marker appears as the answer finishes, not as it starts.
- **Tests.** `switches.test.ts` (9: no change, first answer, model change once, switching back, agent change, both change, new version of the same agent, agent → model, unknown live answer) and `switch-marker.test.tsx` (6: one marker before the changed answer and outside the message, agent with muted model, removed agent, branch switching through the real branch switcher, model naming via list/alias and tidied fallback). chat-ui 338/338. e2e `chat-markers.spec.ts`: echo → Parrot → Parrot → Echo shows exactly two markers, `user-select: none`, two after reload.
- **Verified.** `gate.sh` 82/82. `E2E_PORT=3232 bun turbo test:e2e`: 57 passed, 1 failed: `memory.spec` "nothing is saved from a shared chat", the known under-load failure (099); it passes on its own (3/3). Screenshots (not committed) in `/private/tmp/claude-501/107-screens/`: desktop and 375px, light and dark, from the e2e server; the agent's answer had its `agent` set on the API responses for the shot, since the server doesn't store it.
