---
id: "012"
title: "WS-auth: accounts, orgs, teams and grants"
labels: [wayfinder:build]
status: open
assignee: loop
blockedBy: ["011"]
---

## Question

Better Auth (email + GitHub/Google + OIDC, organization, admin, bearer), personal-org
bootstrap, the team tree, invites, sign-up policies (first user becomes admin, then invite-only),
and grant resolution (`effectiveGrants`, access flowing down the tree) (`PLAN.md` D17, D22, D13).

## Owns

`packages/auth`, auth routes in `packages/server`.

## Done when

`PLAN.md` §11 M1 steps 1–2 pass headlessly; `effectiveGrants` has table-driven tests.

