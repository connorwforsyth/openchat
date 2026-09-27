---
id: "010"
title: "Prototype: Agent Builder and library UX"
labels: [wayfinder:prototype]
status: closed
assignee:
blockedBy: []
---

## Question

How should the Agent Builder and the libraries feel? This covers the builder form with a
side-by-side test chat, the draft vs published states, share vs publish, the use/view/edit
permissions, and the My library / Shared with me / Team and org library tabs (`PLAN.md` D13).

**HITL.** Use the `prototype` skill; link the result here.

## Done when

Connor has picked a direction; the resolution records it for 017.

## Resolution (2026-09-27, Connor)

Decided without a separate prototype: **follow the app shell (009).** The Agent Builder is a page in the Classic shell: the builder form on the left (instructions, model, tools, MCP servers, skills, knowledge files, conversation starters, sandbox provider), a live test chat on the right using the real composer; draft vs published states with a Publish button (publish to a team or org library; share to people/teams with use/view/edit); library pages with tabs My library / Shared with me / Team & org libraries, duplicate-to-personal, import/export. Prompt, Skill and MCP builders follow the same two-pane pattern. Visual language from the 009 reference branch.
