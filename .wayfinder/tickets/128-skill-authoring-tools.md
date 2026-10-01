---
id: "128"
title: "Create, edit and publish skills from a chat (tools)"
labels: [wayfinder:build]
status: in-progress
assignee: loop
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

## Results (2026-10-02, loop)

On `t/128-skill-authoring` (not pushed). No contract change.

**Tools** (`packages/ai/src/tools/registry`): `create-skill.ts`, `update-skill.ts` and `publish-skill.ts`. What they share is in `skill-authoring.ts`: input/output schemas, `SkillAuthoringPorts`, `composeSkillMd` and the model's text. `skill-tools.ts` binds the three tools to a run's ports. All three default to `ask`.
- `create_skill`: name, description, the SKILL.md body (written as Agent Skills frontmatter + body; frontmatter the model wrote is dropped), optional text files (≤20, ≤100k chars each, relative paths). It makes a personal draft.
- `update_skill`: a new draft for a skill the person can `edit`. It takes a new name, description or body, adds or replaces files by path, and `removeFiles`. If only files change, SKILL.md stays byte for byte.
- `publish_skill`: `skillId`, `skillName`, optional `library: { type: team|org, name, id? }`, and `notes`. The server checks that the name and the library match what's stored before it does anything, so the approval card (built from the input) is exactly what happens. With no library, it publishes the next version in the person's own library. With a team or org, it publishes the version and then a copy into that library (`publishVersion` and then `publishToLibrary`, the Publish dialog's two steps). If the skill already lives in that library, its next version is published in place. Results carry `skillId: <id>` so the model can chain calls.

**Server** (`packages/server/src/library/skill-authoring.ts`): the port runs `createItem`/`getItem`/`updateItem`/`publishVersion`/`publishToLibrary` as the run's creator. There is no new rule. Refusals come back as `{ status: "error", message }` results the model can act on: not found, view/use only, not a skill, wrong name, not in that library (it lists the libraries the person can publish to, with ids), someone else's skill, or no file storage. A throw from the store becomes an error result too, so a tool call never fails the run (131). Files are stored as the person's uploads (`purpose: "skill"`); `services.ts` gets the new `storageDriver` option and `server.ts` passes it.

**Turn** (`runs/turn.ts`): a plain chat gets all three, each asking. An agent gets them only by name. It may set create and update to `auto`, but `publish_skill` is forced to `ask`.

**Plan mode**: `PLAN_READ_TOOLS` leaves the three tools out without any change. `plan-mode.test.ts` checks this, `skill-authoring.runs.test.ts` checks a real planning run (no skill tools offered, a call is a tool error, nothing saved), and `plan-mode.runs.test.ts`'s real planner is offered `[]`.

**Chat UI**: `ApprovalCard` takes an optional `subject`. For the skill tools it says what will happen: create shows the name, description, body and files; update lists what changes; publish says "publish the skill X to the Eng team library" or "in your library". `SkillCard` (`conversation/skill-card.tsx`) shows the action, name, `Draft · vN` or `Published · vN`, the library, the file count, and "Open in Library" (the new `libraryItemHref` action, `${libraryHref}/<id>`). An edit has a "Changes to SKILL.md" toggle that uses the artifacts' `versionEdit` with `LazyDiffView`. A refusal shows as the usual error line. `useLibraryInSync` invalidates `library.*` each time a skill call settles, so a published skill is in + and `/` without a reload.

**Golden snapshot** changed on purpose: the plain chat and both agents list the three tools. `agentAsk` sets `create_skill` and `publish_skill` to `auto`; the snapshot shows create as `not-applicable` and publish as `user-approval`. Nothing else in it changed.

**Tests**
- ai: 6 tests in `skill-authoring.test.ts`; the registry defaults are updated.
- server on PGlite: 10 tests in `library/skill-authoring.test.ts` (create, files, quoting, update merge, refusals for view/use/stranger/non-skill/empty/missing file, an editor can change but not publish, personal publish and unchanged, wrong name, team copy visible to a member and then versioned in place, library not joined or name/id mismatch). 3 in `runs/skill-authoring.runs.test.ts` (plain chat ask, approve and read back; plan mode; agent `auto` create while publish still asks). 1 in `plan-mode.test.ts`.
- chat-ui: 8 tests in `skill-card.test.tsx` and 1 in `model/skill-authoring.test.ts`.
- e2e `skill-authoring.spec.ts`: the mock creates, updates and publishes (approving each, checking each card and the diff), then picks the skill from + and its body reaches the model. The mock gained `resultArg` (`$result:<key>`), which fills an argument from the latest tool result.
- Eval: a new `tools` case covers create and publish waiting and landing, and a stranger's update as a tool error.
- gate.sh: install, check, guards ok; `turbo typecheck lint test build` 93/93; `evals --strict` ok.
- Full e2e on 3296: 84 passed and 2 failed: `composer.spec` "the panel's card follows the highlighted model" and `harness.spec` "a new message while a change waits skips the change". Both passed on a rerun (15/15 for those two files). `link-preview.test.tsx` (chat-ui) failed twice under turbo load and passed alone (14/14).

**Open questions**
- Publishing a skill that sits in someone else's personal library is refused. The Library lets an `edit` grantee do it, but the approval card can't truthfully say whose library from the input. This is narrower than the Library UI, not a new policy. Should the tool allow it?
- Rewriting SKILL.md keeps only `name` and `description` in the frontmatter. Other frontmatter fields (e.g. `license`) are lost when the name, description or body changes.
- The update approval lists what changes rather than showing a diff before approval; the diff is shown on the card after the save. A pre-approval diff would need the server to compute it (as `proposeEdits` does for sandbox files).
- "Saved" skills (drafts) aren't in + or `/` until they're published. 127's lists show only published skills, and this keeps that.
