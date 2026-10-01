---
id: "120"
title: "Desktop cowork mode: the agent works in a local folder (proposal first)"
labels: [wayfinder:grilling]
status: open
assignee:
blockedBy: ["116"]
---

## Question

Desktop wave (`PLAN.md` §2 Desktop, D7 cowork, D14 Quick AI and title bar, D24 IPC rules, D28 desktop renderer). Connor said "keen to start desktop" (2026-10-02); the loop treats it as M1 sign-off for planning — he confirms in 122.

D7: the person picks a folder; the agent loop runs in Electron main with a real shell (node-pty, xterm.js), filesystem tools and local stdio MCP; model calls go through the server's `/api/llm` proxy (or local keys / Ollama offline); messages sync to the server conversation; permission modes ask / auto-edit / auto with rules-first safety.

Open questions the map expects: how the local loop's runs sync to the server, and the git-checkpoint UX.

## Done when

- A short design note answering: run sync (local loop writing the same run and message records through the API vs. a local store synced later); offline behaviour; how approvals and the permissions proposal (073) apply locally; git checkpoints (per run vs per change; how Undo shows); local MCP. Questions for Connor at the end; then split into build tickets.

## Owns

`docs/proposals/**`.
