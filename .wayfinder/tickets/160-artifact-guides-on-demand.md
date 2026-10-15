---
id: "160"
title: "Artifact guides on demand: `load_artifact_guide`, our `quickstart`"
labels: [wayfinder:build]
status: open
assignee: loop
blockedBy: ["159"]
---

## Question

Today every turn with the artifact tools carries every kind's full instructions (`packages/ai/src/prompts/compose.ts`, the `kinds` layer). Sites alone add about 40 lines, and each new kind (163–166) brings a component guide. Claude Code has the model call `quickstart` with an intent first, which loads that type's `SKILL.md` (`.context/research/claude-artifacts/`). Connor (2026-10-16): artifacts should "work kind of like Claude Code artefacts".

## Done when

- **Tool:** a registry tool, `load_artifact_guide({ type })`, returns the kind's instructions plus its library guide.
  - It's bound **outside** `ARTIFACT_TOOLS` and `createArtifactTools`, the way `skillAuthoring` is. Every key from `deps.artifacts(run)` is forced to "ask" (`packages/server/src/runs/turn.ts`, `ARTIFACT_APPROVALS`), and this tool needs automatic approval.
- **Composition:** the kinds layer shrinks a kind to one line ("call `load_artifact_guide` first") only when the tool is in the turn's tool set.
  - A turn without it keeps the full text. An agent version that lists `create_artifact` but not the guide tool is one such turn.
  - Document's instructions stay in full, because it's the preferred kind.
- **Tests:** tool tests with `MockLanguageModelV4`, compose tests for both branches, and updated `server/src/runs/__snapshots__/instructions.test.ts.snap` and `e2e/tests/sites.spec.ts`. Evals add a case where the model loads the guide and then creates a site.

## Owns

`packages/ai/src/{tools/registry,prompts}/**`, `packages/server/src/runs/turn.ts` (binding), snapshots, `e2e/tests/sites.spec.ts` (the system-prompt assertion), evals.

## Results (2026-10-16)

- **Tool:** `load_artifact_guide({ type })` in `packages/ai/src/tools/registry/load-artifact-guide.ts` (approval `auto`, capability `artifacts`, registered in `AI_BUILTIN_TOOLS`). It returns the kind's full instructions (its library guide included) from the instance's kind registry, so instance settings such as site origins apply; an unknown type is a `not_found` listing the kinds that have guides.
- **Binding:** `artifactGuideTools` in `packages/server/src/runs/turn.ts`, beside `deps.artifacts` but not in it: a plain chat gets it with `not-applicable`; an agent gets it only when its version lists it by name, with `load_artifact_guide: "auto"` set before the agent's own approvals.
- **Composition:** `kindPrompts` (`packages/ai/src/prompts/artifact-guides.ts`) and `ComposeInput.kindGuidesOnDemand`: when the turn's tool set has the guide tool, each kind but Document shrinks to one line ("Before you create or update a `site` artifact, call `load_artifact_guide` …"). Otherwise the full text stays. The instructions snapshot drops about 760 lines of site guide per turn.
- **Tests:** tool tests (a `MockLanguageModelV4` run that loads a guide), compose tests for both branches, the server instructions snapshot, the plan-mode tool lists, the sandbox registry and golden tool snapshots, and `e2e/tests/sites.spec.ts` (the system prompt points at the tool; a `[tool:load_artifact_guide]` turn returns the guide without asking). E2E sites spec: 7 passed.
- **Eval:** `packages/ai/evals/artifact-guides.eval.ts`: a scripted model loads the Site guide, then creates a site; scores that the system prompt only points, that the create step saw the guide, and that one site was made. 100%.
- **Outside Owns, as the new tool demands:** `packages/sandbox/src/tools/{registry,golden}.test.ts` and their snapshot, `packages/server/src/runs/plan-mode.runs.test.ts`, `packages/ai/src/tools/registry/{registry.test.ts,README.md}`.
- **Gaps:** nothing forces the model to load a guide before `create_artifact`; a site saved without it still meets the kind's checks. Agent builder UI doesn't yet suggest `load_artifact_guide` when `create_artifact` is ticked.
