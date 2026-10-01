---
id: "082"
title: "S4: context compaction (skills moved to 127 and 128)"
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

## Update 2026-10-02

Connor asked for skills in chats now. Skills are split out into 127 (pick, load, `load_skill`) and 128 (create, edit and publish tools). This ticket keeps compaction only, which stays parked until asked.
