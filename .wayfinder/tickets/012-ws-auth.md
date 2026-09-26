---
id: "012"
title: "WS-auth: accounts, orgs, teams and grants"
labels: [wayfinder:build]
status: closed
assignee:
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


## Resolution (2026-09-27, loop)

Merged in [PR #12](https://github.com/connorwforsyth/openchat/pull/12): `packages/auth` with `createAuth` (Better Auth 1.7.6, relations-v2 adapter, UUIDv7 ids, email+password, organization with protected personal orgs, admin, bearer, generic OIDC, GitHub/Google when configured), sign-up policy (`decideSignUp`: invite default, domain, open; first user admin), access rules (`effectiveGrants`, `canAccess`, `checkAccess`), `authRouter` (orgs, teams, grants, shareLinks, me), web client, test helpers. The loop fixed CI timeouts (fast test hashing, 30 s timeout). Verified: 94 auth tests, 47/47 then 50/50 turbo tasks, CI passed. Questions 16–18 logged.
