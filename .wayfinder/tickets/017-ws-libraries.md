---
id: "017"
title: "WS-libraries: builders, sharing and publishing"
labels: [wayfinder:build]
status: closed
assignee:
blockedBy: ["012","010"]
---

## Question

The Agent, Prompt, Skill and MCP builders; share vs publish; use/view/edit; drafts and
published versions; library tabs; public links; import/export including LibreChat agents
(`PLAN.md` D13, following 010's direction).

Speed (D28): library edits, share and publish are optimistic TanStack Query mutations with rollback.

## Owns

Library routes in `packages/server`, `packages/chat-ui/src/library/` (or a new `packages/library-ui`).

## Done when

`PLAN.md` §11 M1 step 5 passes, including the share-then-edit-denied check. Split if large.

## Resolution (2026-09-27, loop)

Merged in [PR #22](https://github.com/connorwforsyth/openchat/pull/22): the `library` router (tabs via `effectiveGrants`; `use` hides instructions/knowledge; drafts; publish into team/org libraries with maintainers; share grants; duplicate; public links; JSON import/export incl. LibreChat agents; versions) and `packages/library-ui` (index with three tabs; Agent/Prompt/Skill/MCP builders with live test chat; Publish/Share/History dialogs; optimistic mutations with rollback); pages under `/library`. Verified: `PLAN.md` §11 step 5 on PGlite with real users/orgs/teams; 73/73 turbo tasks; CI passed. Follow-ups became 032 (access hardening), 033 (draft runs), 034 (audit), 036 (knowledge in turns).
