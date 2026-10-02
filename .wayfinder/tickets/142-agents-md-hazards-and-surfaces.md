---
id: "142"
title: "AGENTS.md: ways to hurt yourself, a hit-every-surface checklist, a glossary"
labels: [wayfinder:task]
status: open
assignee: loop
blockedBy: []
---

## Question

From the T3 Code study (`.context/research/t3code/engineering.md` §3). T3's `AGENTS.md` has two sections openchat lacks: "the three ways to hurt yourself" (concrete hazards with their reason) and "hit every surface" (a checklist an agent walks and reports before calling UI work done). Several loop bugs were "worked on the path that was tested" (100's ⌘K, 134's dropped send). openchat's guard table also lists four guards while `scripts/ci/cli.ts` runs five (`motion` is missing).

## Done when

- `AGENTS.md` gains "Ways to hurt yourself" (killing processes by pattern; assuming a port; full builds in parallel worktrees; deleting untracked files you didn't create; pointing a dev server at the shared compose database), "Hit every surface" (web, desktop, later mobile; palette, shortcut and Settings entry points; roles and grants; the empty `.env`/Ollama path; strings through Lingui; agents and MCP; reverse states), and a short glossary.
- The CI guard table lists `motion`.
- `LOOP.md` step 4 asks each sub-agent to say which surface entries applied.

## Owns

`AGENTS.md`, `.wayfinder/LOOP.md`.
