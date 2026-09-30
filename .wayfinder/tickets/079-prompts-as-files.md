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
