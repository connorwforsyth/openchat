---
id: "079"
title: "S1: instructions as layered files"
labels: [wayfinder:build]
status: open
assignee: loop
blockedBy: []
---

## Question

Stage of the eve assessment (`docs/proposals/2026-09-30-eve-assessment.md`): no migration to eve; adopt its patterns in
our own packages. Connor agreed on 2026-09-30. Read that document's Evidence and "Recommended staged plan" sections first.

## Done when

- New `packages/ai/src/prompts/`: `base/NN-*.md` (identity, safety, tool etiquette, workspace, formatting), concatenated in
  order; `fragments/{workspace,memory,mentions,artifacts}.md`; and a pure
  `composeInstructions({base, agent, memory, mentions, dynamic})` returning ordered sections with provenance.
- The inline strings are replaced by fragments: `WORKSPACE_INSTRUCTIONS` (`server/src/runs/sandbox.ts:35-42`),
  `ai/src/memory/prompt.ts`, the mention wrappers in `runs/workspace-context.ts`. Agent instructions stay DB rows, layered after the base.
- Markdown is bundled as strings at build time (no runtime filesystem reads), so desktop and mobile can embed it.
- The first commit reproduces today's prompts byte for byte; a snapshot test pins the composed prompt for five turn types
  (plain chat, chat with workspace, agent, agent with memory, chat with mentions). e2e unchanged. Gate passes.

## Owns

`packages/ai/src/prompts/**` (new), `packages/ai/src/memory/prompt.ts`, `packages/server/src/runs/{sandbox.ts (instructions only),workspace-context.ts,turn.ts (composition only)}`, build config for raw Markdown imports.

## Results (2026-09-30, loop)

**Built** (branch `t/079-prompts-as-files`, not pushed):

- `packages/ai/src/prompts/`
  - `base/{10-identity,20-safety,30-tool-etiquette,40-workspace,50-formatting}.md`: all empty. Today's prompts have no
    such text, so they compose to nothing; `base/README.md` says so. Nothing was invented.
  - `fragments/workspace.md` (was `WORKSPACE_INSTRUCTIONS`), `fragments/memory.md` (was the strings in
    `memory/prompt.ts`), `fragments/mentions.md` (the wrappers and notes from `runs/workspace-context.ts`),
    `fragments/artifacts.md` (empty: nothing produces artifacts at run time yet).
  - `compose.ts`: pure `composeInstructions({base, agent, dynamic, mentions, memory, preceding})` →
    `{sections: [{layer, source, text}], text}`. Order: base, agent, dynamic, mentions, memory; joined by a blank line;
    empty layers left out.
  - `template.ts`: `fillPrompt`, single-pass `{{name}}` placeholders. `codegen.ts`: pure Markdown → bundle.
  - `README.md`: the layout, the file format and how to edit a prompt.
- **Bundling: codegen, not `?raw`.** `bun run prompts:generate` (in `packages/ai`; `scripts/generate-prompts.ts`) writes
  the checked-in `src/prompts/generated.ts` (`BASE`, `FRAGMENTS`). Packages here are just-in-time TypeScript with no
  build step, consumed by Turbopack, tsc, Vitest, Evalite and bun; plain TypeScript is the one thing all of them (and
  later desktop and mobile) take without a loader. `generated.test.ts` fails when it's stale (checked by editing a
  base file: it fails, and passes again once reverted).
- Callers: `runs/turn.ts` composes through `composeInstructions` in its two places (plain chat and agent);
  `memory/prompt.ts` renders the fragment and appends it through `composeInstructions`; `runs/sandbox.ts` keeps
  exporting `WORKSPACE_INSTRUCTIONS` (the sandbox package's tests import it), now read from the fragment.
  `packages/ai/package.json` gains the `./prompts/*` export and the `prompts:generate` script. No new dependency.

**Byte for byte.** `328dc01` adds `packages/server/src/runs/instructions.test.ts` on the unrefactored code: it runs a
turn through `createServices` (turn resolver + memory wrapper + executor + `runAgent`) and snapshots the system message
the mock model receives, for the five turn types plus ten edge cases (15 snapshots). `dbccbf4` is the refactor; it does
not touch `__snapshots__/instructions.test.ts.snap` (`git diff 328dc01 dbccbf4 -- packages/server/src/runs/__snapshots__`
is empty) and the test passes.

**Verified.** `bun run check` clean. `bun turbo typecheck lint test build --continue`: 81 of 82 tasks pass.
`bun turbo test:e2e`: 44 passed, no e2e file changed. The one failing task is `check:guards` (brand): 8 "OpenChat"
literals in `docs/proposals/2026-09-30-eve-assessment.md`, which arrived on `main` in `9063afe` and is outside this
ticket's Owns, so it's left alone. That file is identical on `origin/main` and all 8 problems are in it, so `main` should fail the same
way (not run there).

**Left / to decide.**

- The brand guard failure above needs a fix on `main` (move the doc under an excluded path, or reword it).
- Memory is added by `withChatMemory`, a wrapper that only sees the turn's composed string, so its sections read
  `preceding` + `memory` rather than the full list. Carrying `sections` on `Turn` (for traces and S3's evals) means
  touching `ai/src/memory/turn.ts` and `runs/memory.ts`, which this ticket doesn't own.
- An inherited quirk, now written down in `compose.ts` and pinned: with memory on, the instructions before it are
  trimmed; without memory an agent's instructions go out with the space around them as stored.
- Agents don't get the workspace fragment even when they have sandbox tools (as before). Whether they should is a
  prompt change for a later ticket.
- Still inline, outside Owns: `ai/src/decider/{auto-route,questions,language-model-evaluator}.ts`,
  `ai/src/title/generate-title.ts` and tool descriptions (S2's registry is the natural home for those).
