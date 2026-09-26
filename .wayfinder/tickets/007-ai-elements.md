---
id: "007"
title: "Install and migrate AI Elements; pierre skills"
labels: [wayfinder:build]
status: open
assignee: loop
blockedBy: ["002"]
---

## Question

Bring in only the AI Elements that shadcn has no equivalent for, and make them Base UI
(`PLAN.md` D5, D16).

- Pick the minimal set (likely conversation, message, reasoning, tool, prompt-input
  pieces). Record the choice and why in the ticket.
- Install them into `packages/ui` and convert them with the `migrate-radix-to-base` skill.
- Run 006's icon codemod over them if 006 has landed; otherwise leave a follow-up line.
- Install the pierre skills: `npx skills add pierrecomputer/pierre` (trees and diffs).

## Owns

`packages/ui/src/components/ai-elements/`, the project skills folder for pierre.

## Done when

- No `@radix-ui/*` import remains in `packages/ui`.
- A demo page in `apps/web` renders each migrated component.
- CI green.
