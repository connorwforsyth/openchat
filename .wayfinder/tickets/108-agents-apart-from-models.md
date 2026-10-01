---
id: "108"
title: "Agents apart from models: agents as chat participants with their own workspace (proposal first)"
labels: [wayfinder:grilling]
status: open
assignee:
blockedBy: []
---

## Question

Connor (2026-10-01): "theoretically you might want to have multiple agents in a chat — not sure if we should decouple agents from models — in my mind it makes sense to — you may have an agent to basically have its own little sandbox almost."

Today a turn's target is **either** a model **or** an agent (an agent version names its own model); the picker lists both.

## Done when

A proposal in `docs/proposals/` covering:
- **The split:** a chat picks a **model**, while agents are **participants** you add or @mention. Each agent brings its instructions, tools and knowledge, and uses its own model or inherits the chat's.
- **Several agents in one chat:** turn-taking, handing off between agents, and showing who answered (107's markers).
- **Each agent's own workspace:** a sandbox per agent, or a folder of the chat's, and how files are shared between them.
- **Permissions:** per-agent grants under 073.
- **Data and contract changes,** and migrating today's agent-as-target chats.

Questions for Connor at the end. Nothing is built until he answers.

## Owns

`docs/proposals/**`.
