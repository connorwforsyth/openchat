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

## Results (2026-10-02, loop)

Built on `t/127-skills-in-chats` in three commits: `contract:` (the approved
field alone), the feature, and this note. Not pushed.

- **Contract (own commit):** `runs.create` `input.skills: [{ id, versionId? }]`
  on the `message` turn (optional, max 20), plus `pickedSkillSchema`, its
  round-trip cases and the regenerated `openapi.json`. Nothing else changed.
- **Stored with the message:** the server keeps what it resolved as a
  `skills` data part (`{ skills: [{ id, name, versionId }] }`,
  `@workspace/ai/messages/skills`), so `messageSchema` didn't change. A
  client-sent `skills` part is dropped. A regenerate reads it back.
- **Composer:** + menu → *Skills* submenu, and `/` lists skills after the
  prompts (menu titled "Skills" or "Prompts and skills"). Choosing one adds a
  removable chip (`components/skill-list.tsx`); picked skills aren't offered
  again; `ComposerValue.skills` carries `{ id, name }`. The chat fetches the
  person's published skills from the three library tabs
  (`apps/web/.../usable-skills.ts`).
- **Server:** `createRun` checks each pick with `canUseLibraryItem` and a
  published version (422 `input.skills.N` otherwise). The turn re-checks,
  and composes each picked `SKILL.md` body (frontmatter stripped) as a
  `skills`-layer section with source `skill:<itemId>@<versionId>`
  (`fragments/skills.md`; after the agent's instructions, before plan
  mode's fragment). Files are read by path through `load_skill`, read-only,
  from storage via `skillFiles`.
- **Agents:** attached skills are listed by name and description;
  `load_skill` (registry, `approval: "auto"`, capability `skills`) returns
  instructions and the file list, or one file by path, and only for skills
  attached to that agent or picked for that message. Plan mode keeps it.
- **History:** a user message shows "Used the skill …".
- **Tests:** unit (ai, server real turns over PGlite, client, composer,
  chat-ui, web), the tool golden snapshot now records `load_skill`
  (additions only), e2e `skills.spec.ts` (2 tests), grounding eval case.
- **Verified:** `bun run check` and `check:guards` exit 0 on each commit;
  `gate.sh`: 93/93 turbo tasks, `evals --strict` ok; e2e via the queue on
  3290: 85 passed, no flakes.

Open: attached skills ride with the agent (the author's use was checked on
save), so a `use`-only consumer's model can read them, and `load_skill`
results show in the transcript; an edited message drops its skills; the
library builder's test chat doesn't offer skills; prompts still aren't wired
into the real chat's `/` (only skills are).
