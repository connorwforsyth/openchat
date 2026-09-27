---
id: "042"
title: "Contract gaps from integration (owner review)"
labels: [wayfinder:build]
status: closed
assignee:
blockedBy: []
---

## Question

Gaps found while wiring the server (038) and web app (039). Each is a small contract change, so
they go in **one contract PR that Connor reviews and merges** (`packages/contract/README.md`):
1. `Invitation` gains a `token` (random, shown once) and `acceptInvitation` takes `{ token }`
   (Q16: separate random invite tokens).
2. `setBudget` takes `orgId`.
3. `keys.create` gets a typed error for a missing `ENCRYPTION_KEY`.
4. `Artifact.latestVersionId` becomes nullable.
5. A `GET /api/health` procedure (liveness + db/jobs readiness) for compose healthchecks.
6. `observability.recordContent` in config (Q28), `storage` default path `./.data/files`, and an org
   policy to turn off client cache persistence (D28) in config/`OrgPolicy`.
7. User settings gain `shortcuts` overrides (Q31).

## Owns

`packages/contract`, `packages/config`, then the follow-on server/client changes in a second PR.

## Done when

Connor has merged the contract PR; the follow-on PR wires each field.

## Resolution (2026-09-27, Connor + loop)

Connor approved and the loop merged [PR #31](https://github.com/connorwforsyth/openchat/pull/31): one-time random invite tokens (stored hashed) accepted by token; `setBudget` scoped by org; typed `ENCRYPTION_UNAVAILABLE`; nullable `latestVersionId`; `GET /api/health` (`?ready=true` 503 when db/jobs are down); `observability.recordContent`; storage default `./.data/files`; an org policy to turn off client cache persistence; shortcut overrides in user settings. Old invite/budget shapes work for one release. Local gate 77/77.
