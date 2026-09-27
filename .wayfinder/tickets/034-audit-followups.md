---
id: "034"
title: "Audit follow-ups from 032"
labels: [wayfinder:build]
status: open
assignee: loop
blockedBy: ["032"]
---

## Question

Findings 032's audit left for a follow-up:
1. `library/publishing.ts` `setMaintainers` returns a 500 for `mcp_server` / `preset` (the db
   `TABLES` map only has agent, prompt, skill) — fix and test.
2. Library **duplicate** keeps the original's knowledge-file ids even after the grant is revoked;
   drop file ids the copier can't read, and say so in the response/UI.
3. `db/queries/provider-keys.ts` looks keys up by id without a scope — require the owning scope
   (user/team/org/instance) in every query.
4. `sandbox/exec-job.ts` trusts its job data — validate with zod and re-check access when it runs.
5. `jobs/handlers.ts` `title.generate` writes as the system: confirm it can't be triggered for a
   conversation the requester can't edit.

## Owns

`packages/server` (library publishing/duplicate, jobs), `packages/db` (provider-keys queries),
`packages/sandbox` (exec job), tests.

## Done when

Each item has a regression test and is fixed; CI green.
