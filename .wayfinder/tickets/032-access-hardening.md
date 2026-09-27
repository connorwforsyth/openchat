---
id: "032"
title: "Security: membership-checked maintainers; runs check agent access"
labels: [wayfinder:build]
status: closed
assignee:
blockedBy: ["017"]
---

## Question

Two gaps found by 017's agent:
1. In `packages/auth`, a user removed from an org still counts as a maintainer of that org's
   published items when sharing or creating public links (the library handlers already require
   current membership; the auth grants/shareLinks handlers don't).
2. `POST /api/runs` doesn't check that the caller may **use** the requested agent (published
   version) — anyone who knows an agent id can run it. Use 017's `canUseLibraryItem` in the turn
   resolver / createRun path.
Add regression tests for both, plus a quick audit of every handler that accepts a resource id for a
missing access check (list findings; fix the obvious ones).

## Owns

`packages/auth` (grants, shareLinks handlers, access rules), `packages/server` (runs createRun /
turn resolver access check), tests.

## Done when

Both regression tests fail before and pass after; the audit list is in the resolution.

## Resolution (2026-09-27, loop)

Merged in [PR #27](https://github.com/connorwforsyth/openchat/pull/27) (combined with 033/034/036): maintainers act only while still members of the owning org/team (grants, share links); `createRun`, the turn resolver and approvals check the caller may **use** the agent (NOT_FOUND on refusal); audit of every id-taking handler (findings fixed in 034). Regression tests failed before the fix. Local gate 73/73.
