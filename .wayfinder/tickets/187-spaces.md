---
id: "187"
title: "Spaces: nested spaces, shared content, allowances and per-key usage"
labels: [wayfinder:build]
status: open
assignee: loop
blockedBy: ["187a", "188", "189", "190", "191", "192", "193"]
---

## Destination

Spaces replace orgs in the product: nested spaces, multi-membership,
owner-managed membership and roles, scoped skills, agents and chats shared
within a space and visible to its sub-spaces' members, a space token
allowance granted by the owner, and admin-created keys with usage tracked per
key. Demoable end to end.

Connor (2026-10-20): "Instead of organisation settings, frame it as spaces.
Spaces can have scoped skills, agents and chats that they share with one
another. Sub-spaces: a user can be the owner of a space and promote people
into it. An admin with access to Postgres can create a chain of sub-spaces.
People can be in multiple spaces and see content between them. Also: team
token allowance, and users being able to use it with permission from the
space owner. An admin can track token usage against a specific key they
created within that team."

## Decisions (each its own ticket, resolved AFK from D17)

| Ticket | Decision | Resolution |
|---|---|---|
| [188](188-space-is-org-plus-team-tree.md) | Rename or new layer? | A space is the org (root) or a team (sub-space). No new tenancy table. |
| [189](189-space-visibility.md) | Visibility between spaces | Flows down only: parent to descendants. Not up, not sideways. |
| [190](190-space-roles.md) | Roles | owner, admin, member. Sub-space owner = team `admin`. |
| [191](191-active-space.md) | Picking the active space | The switcher sets the context of new chats (D17 chat context). |
| [192](192-space-allowance.md) | Allowance model | Monthly token pool per space; members draw on it with an approved grant. |
| [193](193-per-key-usage.md) | Per-key usage | `transaction.provider_key_id`, resolved when usage is recorded. |

## Done when

- Contract (187a, its own draft PR): `spaces` procedure group.
- DB: `space_allowance`, `space_allowance_grant`, `transaction.provider_key_id`;
  seed script for a demo tree; `bun run spaces:chain` creates a chain of
  sub-spaces from Postgres access alone.
- Server: list my spaces (tree), space detail, members (add, promote, remove),
  share a skill/agent/chat to a space, allowance request and approval, usage
  by key. Pure core: `effectiveSpaceAccess`, `allowanceFor`.
- UI: space switcher in the sidebar header; space home lists its content and
  what flows down from parent spaces; Space settings in the settings shell
  (members, sub-spaces, allowance, keys and usage), replacing the old
  `/admin/[orgId]` second sidebar.
- Tests: PGlite tests for access, allowance and per-key usage.

## Owns

`packages/auth/src/spaces*`, `packages/auth/src/handlers/spaces*`,
`packages/db/src/schema/spaces.ts`, `packages/db/src/queries/spaces*`,
`packages/db/src/seed/**`, `packages/db/drizzle/*spaces*`,
`packages/db/src/queries/usage.ts` (key attribution only),
`apps/web/app/(app)/**/spaces/**`, `apps/web/app/(app)/_shared/settings/space-*`,
`apps/web/app/(app)/(pages)/admin/**`, sidebar header switcher
(`page-shell.tsx`, `chat-route.tsx`), `apps/web/app/(app)/_shared/{app-frame,global-surfaces}.tsx`
(active space), `apps/web/app/(app)/_shared/settings/settings-{route,view}*`,
`apps/web/app/(app)/(pages)/space/**`, `apps/web/lib/routes.ts`, `apps/web/proxy.ts`,
`packages/auth/scripts/seed-spaces.ts`, `packages/db/src/schema/usage.ts` (one column),
`e2e/support/admin.ts`, `e2e/tests/orgs.spec.ts`.

## Results (2026-10-20, loop)

- **Contract** (187a, draft PR #148): additive `spaces` group.
- **Core** (`packages/auth/src/spaces.ts`, pure): `effectiveSpaceAccess` (my
  spaces as an outline, with access `member | admin | root_member`, my role
  and `canManage`), `contentSpacesFor` (a space and its ancestors: content
  flows down), `canSeeContent`, `allowanceFor` (grant left capped by pool
  left; owners draw on the pool directly).
- **DB**: `space_allowance`, `space_allowance_grant`,
  `transaction.provider_key_id` (migration `20261020100252_spaces`);
  `recordTransaction` attributes usage to the paying scope's newest key for
  the model's provider. Queries in `packages/db/src/queries/spaces.ts`.
- **Handlers** (`packages/auth/src/handlers/spaces.ts`): the 14 procedures.
  Sharing is a `resource_grant` to the space (`use` for agents and skills,
  `viewer` for chats) and needs `manage` on the item. Root-space member
  changes go through the org handlers (Better Auth).
- **UI**: space switcher in the sidebar header (sets the new-chat context,
  remembered per browser); `/space` lists the active space's content with
  "From <parent>" badges and a share control; Settings gains a "Space:
  <name>" group (Members, Sub-spaces, Token allowance, Keys and usage, and
  for root spaces Budgets, Policies, Audit). `/admin/[orgId]/*` redirect
  there; no second sidebar.
- **Scripts**: `bun run --cwd packages/auth seed:spaces` (demo tree) and
  `bun run --cwd packages/db spaces:chain <org-slug> "A/B/C"`.
- **Tests**: pure core (9), PGlite handler tests (6: tree and roles,
  flow-down visibility, share refusal, owner promotion, allowance approval,
  per-key usage), settings view (2 new). e2e `orgs.spec` and the account
  setup moved to Space settings.

### Not done (follow-ups)

- The token allowance isn't enforced before a run yet (shown and approved only).
- Sidebar chat rows don't show their space; `/space` does.
- Root-space sub-spaces still use the team-tree editor, worded "team".
- Inviting straight into a sub-space (today: invite to the root, then add).
