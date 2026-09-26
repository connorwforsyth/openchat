---
id: "007"
title: "Install and migrate AI Elements; pierre skills"
labels: [wayfinder:build]
status: closed
assignee:
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

## Resolution (2026-09-26, loop)

Built in [PR #5](https://github.com/connorwforsyth/openchat/pull/5): AI Elements `message` (Streamdown), `reasoning`, `tool` and `prompt-input` migrated to Base UI in `packages/ui/src/components/ai-elements/` (choices in its README). `conversation` is covered by shadcn's `message-scroller`; `code-block` waits for @pierre/diffs (020); `PromptInputCommand*` removed because cmdk pulls in Radix. No Radix remains anywhere. Icons via the registry, strings via Lingui, semantic tokens only. Demo at `/dev/ai-elements`. pierre `diffs` + `trees` skills in `.claude/skills`.

Verified: no `@radix-ui` in `packages/ui`; 17/17 turbo tasks after rebasing; empty-env production `/dev/ai-elements` returns 200; clicked through in a browser; CI passed. Questions 10–12 logged.
