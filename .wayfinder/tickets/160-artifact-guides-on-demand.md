---
id: "160"
title: "Artifact guides on demand: `load_artifact_guide`, our `quickstart`"
labels: [wayfinder:build]
status: open
assignee:
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
