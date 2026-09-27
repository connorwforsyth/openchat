---
id: "015"
title: "WS-chat-ui: conversation, branches, artifacts"
labels: [wayfinder:build]
status: open
assignee: loop
blockedBy: ["008","009"]
---

## Question

The conversation view, message parts rendering, branch switcher, `AppHeader` with the
context chip (following 009's direction), the artifacts panel, the memory note, and feedback
controls, built from `@workspace/ui` against mock data from the contract (`PLAN.md` D14, D20, D21).

Performance (D27): don't virtualise the message list; re-render the streaming message in place; lazy-load the artifacts panel, reasoning views, code views and KaTeX (keep KaTeX's MathML); `content-visibility: auto` on older messages is allowed.

Speed (D28): message rows memoised by id so a streaming token re-renders only the streaming message; motion tokens (0/100/250/350 ms, transform/opacity only, instant in, ~150 ms fade out) added to `packages/ui` and the rule added to `AGENTS.md`.

## Owns

`packages/chat-ui`.

## Done when

Component tests in Vitest browser mode; a Storybook-style demo route in `apps/web`; no raw
colours, icons or strings (the 004 guards pass).
