---
id: "082"
title: "S4 (optional): skills on demand and context compaction"
labels: [wayfinder:build]
status: open
assignee:
blockedBy: ["079", "080", "081"]
---

## Question

Stage of the eve assessment (`docs/proposals/2026-09-30-eve-assessment.md`): no migration to eve; adopt its patterns in
our own packages. Connor agreed on 2026-09-30. Read that document's Evidence and "Recommended staged plan" sections first.

Only if S1–S3 land well; confirm with Connor first.

## Done when

- `SKILL.md` skills as library items (D13), loaded through a `load_skill` tool from the registry.
- Context compaction at a token threshold, behind a config flag.
- Evals show no regression and a measurable token saving on long chats. Gate passes.

## Owns

`packages/ai/src/{tools/registry,prompts,agent}/**`, `packages/library-ui/**` (skills), tests.
