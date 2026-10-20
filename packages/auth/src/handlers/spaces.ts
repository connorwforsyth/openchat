import { call } from "@orpc/server";
import type { TeamId, UserId } from "@workspace/contract/schemas/common";
import type {
  AllowanceGrant,
  Space,
  SpaceContentItem,
  SpaceRef,
} from "@workspace/contract/schemas/spaces";
import {
  orgRoleSchema,
  type TeamRole,
  teamRoleSchema,
} from "@workspace/contract/schemas/tenancy";
import type { Db } from "@workspace/db/client";
import { upsertGrant } from "@workspace/db/queries/grants";
import {
  type AllowanceGrantRow,
  decideAllowanceGrant,
  getSpaceAllowance,
  keyUsageForSpace,
  listAllowanceGrants,
  listSpaceContent,
  monthOf,
  requestAllowanceGrant,
  type SpaceContentRow,
  setSpaceAllowance,
  tokensByUser,
} from "@workspace/db/queries/spaces";
import { resourceGrant } from "@workspace/db/schema/access";
import { member, organization, user } from "@workspace/db/schema/auth";
import { team, teamMember } from "@workspace/db/schema/tenancy";
import { and, asc, count, eq, inArray } from "drizzle-orm";

import { descendantsOf, strongestOrgRole } from "../access";
import { checkAccess } from "../resources";
import {
  allowanceFor,
  canSeeContent,
  contentSpacesFor,
  effectiveSpaceAccess,
  type SpaceOrgFact,
  spaceRoleToTeamRole,
  teamRoleToSpaceRole,
} from "../spaces";
import { authed } from "./base";
import { nowOf } from "./context";
import { orgs } from "./orgs";
import { toUserSummary } from "./views";

// The `spaces` procedure group (ticket 187): orgs and the team tree spoken
// of as one tree of spaces. Facts are loaded here; who sees and manages
// what is decided by the pure functions in `../spaces`.

const loadFacts = async (db: Db, userId: UserId): Promise<SpaceOrgFact[]> => {
  const memberships = await db
    .select({ org: organization, role: member.role })
    .from(member)
    .innerJoin(organization, eq(organization.id, member.organizationId))
    .where(eq(member.userId, userId))
    .orderBy(asc(organization.createdAt));
  const orgIds = memberships.map((row) => row.org.id);
  if (orgIds.length === 0) {
    return [];
  }
  const [orgCounts, teams, teamCounts, myTeams] = await Promise.all([
    db
      .select({ n: count(), orgId: member.organizationId })
      .from(member)
      .where(inArray(member.organizationId, orgIds))
      .groupBy(member.organizationId),
    db
      .select()
      .from(team)
      .where(inArray(team.orgId, orgIds))
      .orderBy(asc(team.createdAt), asc(team.id)),
    db
      .select({ n: count(), teamId: teamMember.teamId })
      .from(teamMember)
      .innerJoin(team, eq(team.id, teamMember.teamId))
      .where(inArray(team.orgId, orgIds))
      .groupBy(teamMember.teamId),
    db
      .select({ role: teamMember.role, teamId: teamMember.teamId })
      .from(teamMember)
      .where(eq(teamMember.userId, userId)),
  ]);
  const orgCount = new Map(orgCounts.map((row) => [row.orgId, row.n]));
  const teamCount = new Map(teamCounts.map((row) => [row.teamId, row.n]));
  const myRoles = new Map(
    myTeams.map((row) => [row.teamId, teamRoleSchema.parse(row.role)])
  );
  return memberships.flatMap(({ org, role }) => {
    const orgRole = strongestOrgRole(role);
    if (!orgRole) {
      return [];
    }
    const orgTeams = teams.filter((each) => each.orgId === org.id);
    return [
      {
        id: org.id,
        isPersonal: org.isPersonal,
        memberCount: orgCount.get(org.id) ?? 0,
        name: org.name,
        role: orgRole,
        teamRoles: new Map<TeamId, TeamRole>(
          orgTeams.flatMap((each) => {
            const mine = myRoles.get(each.id);
            return mine ? [[each.id, mine] as const] : [];
          })
        ),
        teams: orgTeams.map((each) => ({
          id: each.id,
          memberCount: teamCount.get(each.id) ?? 0,
          name: each.name,
          parentId: each.parentId,
        })),
      },
    ];
  });
};

interface Located {
  readonly all: readonly Space[];
  readonly fact: SpaceOrgFact;
  readonly ref: SpaceRef;
  readonly space: Space;
}

/** The caller's view of one space, or `undefined` when they can't see it. */
const locate = async (
  db: Db,
  userId: UserId,
  input: { readonly id: string; readonly type: "org" | "team" }
): Promise<Located | undefined> => {
  const facts = await loadFacts(db, userId);
  const all = effectiveSpaceAccess({ orgs: facts });
  const space = all.find(
    (each) => each.id === input.id && each.type === input.type
  );
  const fact = space && facts.find((each) => each.id === space.orgId);
  if (!(space && fact)) {
    return;
  }
  return {
    all,
    fact,
    ref: { id: space.id, type: space.type } as SpaceRef,
    space,
  };
};

const nameOf = (all: readonly Space[], ref: SpaceRef): string =>
  all.find((each) => each.id === ref.id && each.type === ref.type)?.name ?? "";

const toContentItem = (
  all: readonly Space[],
  row: SpaceContentRow
): SpaceContentItem => ({
  resourceId: row.resourceId as SpaceContentItem["resourceId"],
  resourceType: row.resourceType,
  sharedAt: row.grantedAt.toISOString(),
  sharedBy: toUserSummary(row.grantedBy),
  sharedIn: row.space,
  sharedInName: nameOf(all, row.space),
  title: row.title,
});

/** The space and every space below it: where its usage rolls up from. */
const subtreeOf = (located: Located): SpaceRef[] =>
  located.ref.type === "org"
    ? [
        located.ref,
        ...located.fact.teams.map(
          (each): SpaceRef => ({ id: each.id, type: "team" })
        ),
      ]
    : descendantsOf(located.ref.id, located.fact.teams).map(
        (id): SpaceRef => ({ id, type: "team" })
      );

const toGrant = (
  row: AllowanceGrantRow,
  who: typeof user.$inferSelect,
  usedTokens: number
): AllowanceGrant => ({
  decidedAt: row.decidedAt?.toISOString() ?? null,
  decidedBy: row.decidedBy,
  id: row.id,
  monthlyTokens: row.monthlyTokens,
  note: row.note,
  requestedAt: row.requestedAt.toISOString(),
  status: row.status,
  usedTokens,
  user: toUserSummary(who),
});

const allowanceView = async (
  db: Db,
  located: Located,
  userId: UserId,
  now: Date
) => {
  const [pool, grants, used] = await Promise.all([
    getSpaceAllowance(db, located.ref),
    listAllowanceGrants(db, located.ref),
    tokensByUser(db, subtreeOf(located), now),
  ]);
  const poolUsed = [...used.values()].reduce((sum, n) => sum + n, 0);
  const mine = grants.find((row) => row.grant.userId === userId)?.grant ?? null;
  const visible = located.space.canManage
    ? grants
    : grants.filter((row) => row.grant.userId === userId);
  return {
    grants: visible.map((row) =>
      toGrant(row.grant, row.user, used.get(row.grant.userId) ?? 0)
    ),
    monthlyTokens: pool?.monthlyTokens ?? null,
    myRemainingTokens: allowanceFor({
      grant: mine,
      poolTokens: pool?.monthlyTokens ?? null,
      poolUsed,
      userUsed: used.get(userId) ?? 0,
    }),
    resetsAt: monthOf(now).to.toISOString(),
    usedTokens: poolUsed,
  };
};

const membersOf = async (db: Db, ref: SpaceRef) => {
  if (ref.type === "org") {
    const rows = await db
      .select({ member, user })
      .from(member)
      .innerJoin(user, eq(user.id, member.userId))
      .where(eq(member.organizationId, ref.id))
      .orderBy(asc(member.createdAt));
    return rows.map((row) => ({
      addedAt: row.member.createdAt.toISOString(),
      role: strongestOrgRole(row.member.role) ?? orgRoleSchema.enum.member,
      user: toUserSummary(row.user),
    }));
  }
  const rows = await db
    .select({ teamMember, user })
    .from(teamMember)
    .innerJoin(user, eq(user.id, teamMember.userId))
    .where(eq(teamMember.teamId, ref.id))
    .orderBy(asc(teamMember.addedAt));
  return rows.map((row) => ({
    addedAt: row.teamMember.addedAt.toISOString(),
    role: teamRoleToSpaceRole(teamRoleSchema.parse(row.teamMember.role)),
    user: toUserSummary(row.user),
  }));
};

export const spaces = {
  allowance: authed.spaces.allowance.handler(
    async ({ context, errors, input }) => {
      const located = await locate(context.db, context.userId, input);
      if (!located) {
        throw errors.NOT_FOUND();
      }
      return allowanceView(context.db, located, context.userId, nowOf(context));
    }
  ),

  content: authed.spaces.content.handler(async ({ context, errors, input }) => {
    const located = await locate(context.db, context.userId, input);
    if (!located) {
      throw errors.NOT_FOUND();
    }
    if (!canSeeContent(located.space, located.all, located.fact.teams)) {
      return [];
    }
    const rows = await listSpaceContent(
      context.db,
      contentSpacesFor(located.ref, located.fact.id, located.fact.teams)
    );
    return rows.map((row) => toContentItem(located.all, row));
  }),

  createChild: authed.spaces.createChild.handler(
    async ({ context, errors, input }) => {
      const located = await locate(context.db, context.userId, input);
      if (!located) {
        throw errors.NOT_FOUND();
      }
      if (!located.space.canManage || located.space.isPersonal) {
        throw errors.FORBIDDEN();
      }
      const [row] = await context.db
        .insert(team)
        .values({
          name: input.name,
          orgId: located.fact.id,
          parentId: located.ref.type === "team" ? located.ref.id : null,
        })
        .returning();
      if (!row) {
        throw new Error("insert returned no row");
      }
      const after = await locate(context.db, context.userId, {
        id: row.id,
        type: "team",
      });
      if (!after) {
        throw new Error("new space vanished");
      }
      return after.space;
    }
  ),

  decideAllowance: authed.spaces.decideAllowance.handler(
    async ({ context, errors, input }) => {
      const located = await locate(context.db, context.userId, input);
      if (!located) {
        throw errors.NOT_FOUND();
      }
      if (!located.space.canManage) {
        throw errors.FORBIDDEN();
      }
      const now = nowOf(context);
      const row = await decideAllowanceGrant(
        context.db,
        {
          decidedBy: context.userId,
          grantId: input.grantId,
          ...(input.monthlyTokens
            ? { monthlyTokens: input.monthlyTokens }
            : {}),
          space: located.ref,
          status: input.decision,
        },
        now
      );
      if (!row) {
        throw errors.NOT_FOUND();
      }
      const [who] = await context.db
        .select()
        .from(user)
        .where(eq(user.id, row.userId));
      if (!who) {
        throw new Error("grant's user vanished");
      }
      const used = await tokensByUser(context.db, subtreeOf(located), now);
      return toGrant(row, who, used.get(row.userId) ?? 0);
    }
  ),

  get: authed.spaces.get.handler(async ({ context, errors, input }) => {
    const located = await locate(context.db, context.userId, input);
    if (!located) {
      throw errors.NOT_FOUND();
    }
    return located.space;
  }),

  keyUsage: authed.spaces.keyUsage.handler(
    async ({ context, errors, input }) => {
      const located = await locate(context.db, context.userId, input);
      if (!located) {
        throw errors.NOT_FOUND();
      }
      if (!located.space.canManage) {
        throw errors.FORBIDDEN();
      }
      const now = nowOf(context);
      const { from, to } = monthOf(now);
      const rows = await keyUsageForSpace(context.db, located.ref, now);
      return {
        from: from.toISOString(),
        rows: rows.map((row) => ({
          costMicros: row.costMicros,
          createdBy: row.key?.creator ? toUserSummary(row.key.creator) : null,
          hint: row.key?.hint ?? "",
          keyId: row.key?.id ?? null,
          label: row.key?.label ?? "",
          lastUsedAt: row.key?.lastUsedAt?.toISOString() ?? null,
          provider: row.key?.provider ?? null,
          tokens: row.tokens,
          transactions: row.transactions,
        })),
        to: to.toISOString(),
      };
    }
  ),

  list: authed.spaces.list.handler(async ({ context }) =>
    effectiveSpaceAccess({ orgs: await loadFacts(context.db, context.userId) })
  ),

  members: authed.spaces.members.handler(async ({ context, errors, input }) => {
    const located = await locate(context.db, context.userId, input);
    if (!located) {
      throw errors.NOT_FOUND();
    }
    return membersOf(context.db, located.ref);
  }),

  removeMember: authed.spaces.removeMember.handler(
    async ({ context, errors, input }) => {
      const located = await locate(context.db, context.userId, input);
      if (!located) {
        throw errors.NOT_FOUND();
      }
      if (located.ref.type === "org") {
        await call(
          orgs.removeMember,
          { orgId: located.ref.id, userId: input.userId },
          { context }
        );
        return;
      }
      // Anyone may leave a sub-space; removing others needs an owner.
      if (!located.space.canManage && input.userId !== context.userId) {
        throw errors.FORBIDDEN();
      }
      await context.db
        .delete(teamMember)
        .where(
          and(
            eq(teamMember.teamId, located.ref.id),
            eq(teamMember.userId, input.userId)
          )
        );
    }
  ),

  requestAllowance: authed.spaces.requestAllowance.handler(
    async ({ context, errors, input }) => {
      const located = await locate(context.db, context.userId, input);
      if (!located) {
        throw errors.NOT_FOUND();
      }
      if (located.space.access === "root_member") {
        throw errors.FORBIDDEN();
      }
      const now = nowOf(context);
      const row = await requestAllowanceGrant(
        context.db,
        {
          monthlyTokens: input.monthlyTokens,
          note: input.note,
          orgId: located.fact.id,
          space: located.ref,
          userId: context.userId,
        },
        now
      );
      const [who] = await context.db
        .select()
        .from(user)
        .where(eq(user.id, context.userId));
      if (!who) {
        throw new Error("caller vanished");
      }
      const used = await tokensByUser(context.db, subtreeOf(located), now);
      return toGrant(row, who, used.get(context.userId) ?? 0);
    }
  ),

  setAllowance: authed.spaces.setAllowance.handler(
    async ({ context, errors, input }) => {
      const located = await locate(context.db, context.userId, input);
      if (!located) {
        throw errors.NOT_FOUND();
      }
      if (!located.space.canManage) {
        throw errors.FORBIDDEN();
      }
      await setSpaceAllowance(context.db, {
        monthlyTokens: input.monthlyTokens,
        orgId: located.fact.id,
        space: located.ref,
        userId: context.userId,
      });
      return allowanceView(context.db, located, context.userId, nowOf(context));
    }
  ),

  setMember: authed.spaces.setMember.handler(
    async ({ context, errors, input }) => {
      const located = await locate(context.db, context.userId, input);
      if (!located) {
        throw errors.NOT_FOUND();
      }
      if (located.ref.type === "org") {
        await call(
          orgs.updateMember,
          { orgId: located.ref.id, role: input.role, userId: input.userId },
          { context }
        );
      } else {
        if (!located.space.canManage) {
          throw errors.FORBIDDEN();
        }
        const [inRoot] = await context.db
          .select({ id: member.id })
          .from(member)
          .where(
            and(
              eq(member.organizationId, located.fact.id),
              eq(member.userId, input.userId)
            )
          );
        // Only people already in the root space can be added (190); others
        // are invited to the root first.
        if (!inRoot) {
          throw errors.NOT_FOUND();
        }
        const role = spaceRoleToTeamRole(input.role);
        await context.db
          .insert(teamMember)
          .values({ role, teamId: located.ref.id, userId: input.userId })
          .onConflictDoUpdate({
            set: { role },
            target: [teamMember.teamId, teamMember.userId],
          });
      }
      const found = (await membersOf(context.db, located.ref)).find(
        (each) => each.user.id === input.userId
      );
      if (!found) {
        throw new Error("member vanished");
      }
      return found;
    }
  ),

  share: authed.spaces.share.handler(async ({ context, errors, input }) => {
    const located = await locate(context.db, context.userId, input);
    if (!located || located.space.access === "root_member") {
      throw errors.NOT_FOUND();
    }
    const ref = {
      resourceId: input.resourceId,
      resourceType: input.resourceType,
    } as Parameters<typeof checkAccess>[2];
    const allowed = await checkAccess(
      context.db,
      context.userId,
      ref,
      "manage",
      context.config.policies
    );
    if (!allowed.ok) {
      throw allowed.error === "forbidden"
        ? errors.FORBIDDEN()
        : errors.NOT_FOUND();
    }
    const granted = await upsertGrant(context.db, {
      grantedBy: context.userId,
      permission: input.resourceType === "conversation" ? "viewer" : "use",
      principal: located.ref,
      resource: ref,
    });
    if (!granted.ok) {
      throw new Error("space share refused a fixed permission");
    }
    const rows = await listSpaceContent(context.db, [located.ref]);
    const row = rows.find((each) => each.resourceId === input.resourceId);
    if (!row) {
      throw new Error("shared item vanished");
    }
    return toContentItem(located.all, row);
  }),

  unshare: authed.spaces.unshare.handler(async ({ context, errors, input }) => {
    const located = await locate(context.db, context.userId, input);
    if (!located) {
      throw errors.NOT_FOUND();
    }
    const where = and(
      eq(resourceGrant.resourceType, input.resourceType),
      eq(resourceGrant.resourceId, input.resourceId),
      eq(resourceGrant.principalType, located.ref.type),
      eq(resourceGrant.principalId, located.ref.id)
    );
    const [grant] = await context.db.select().from(resourceGrant).where(where);
    if (!grant) {
      throw errors.NOT_FOUND();
    }
    // Whoever shared it, or an owner of the space, may take it back.
    if (grant.grantedBy !== context.userId && !located.space.canManage) {
      throw errors.FORBIDDEN();
    }
    await context.db.delete(resourceGrant).where(where);
  }),
};
