---
id: "127"
title: "Skills in chats: pick from the + menu or /, load into the turn, load_skill for agents"
labels: [wayfinder:build]
status: in-progress
assignee: loop
blockedBy: ["106"]
---

## Question

Connor (2026-10-02): skills don't work in chats. He should be able to open the + menu and see all his skills, or type `/` in the composer and add one. This is the skills half of 082; compaction stays in 082.

Contract change approved by Connor (2026-10-02): a message can carry the skill IDs that were picked (additive and optional).

## Done when

- **Composer:**
  - The + menu has a "Skills" submenu listing the skills the person can use (theirs, their org's and shared ones).
  - `/` lists skills alongside prompt templates.
  - Choosing a skill adds a removable chip to the message.
- **Contract (own commit):** an optional `skills: [{id, versionId?}]` on the send-message input. Persist it with the message so it shows in history.
- **Server:**
  - A turn with picked skills gets each skill's `SKILL.md` instructions as a composed prompt section with provenance (`packages/ai/src/prompts/compose`).
  - Bundled files are readable by path, read-only.
  - Access is checked with the same "usable" rule as library items.
- **Agents:**
  - An agent's `definition.skills` are offered on demand: the agent's instructions list each skill's name and description.
  - A `load_skill` tool in the registry returns the instructions and the file list. It runs with `approval: "auto"` and only loads skills attached to that agent or picked for that message.
- **Tests:** unit tests for the options, composition and tool; e2e covering pick from + and from `/`, the chip, a mock-model turn that echoes the skill's marker text, and an agent calling `load_skill`. Evals add a case.

## Owns

`packages/composer/**` (skills), `packages/ai/src/{tools/registry,prompts}/**`, `packages/server/src/runs/**` (skill loading), the contract field, e2e/evals.
