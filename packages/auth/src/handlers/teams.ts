import type { OrgId, TeamId, UserId } from "@workspace/contract/schemas/common";
import { teamRoleSchema } from "@workspace/contract/schemas/tenancy";
import type { Db } from "@workspace/db/client";
import { resourceGrant } from "@workspace/db/schema/access";
import { member, user } from "@workspace/db/schema/auth";
import { team, teamMember } from "@workspace/db/schema/tenancy";
import { and, asc, eq } from "drizzle-orm";

import { canManageTeam, type TeamNode, wouldCreateCycle } from "../access";
import { loadTeams, orgRoleOf, teamAdminOf, toTree } from "../resources";
import { authed } from "./base";
import { toTeam, toUserSummary } from "./views";

// The team tree (D17): ours, because Better Auth's teams are flat. Org
// owners and admins manage every team; a team admin manages their team and
// everything below it. Any org member may read the tree.

const loadTeam = async (db: Db, id: TeamId) => {
  const [row] = await db.select().from(team).where(eq(team.id, id));
  return row;
};

interface TeamAuthority {
  readonly may: (teamId: TeamId | null) => boolean;
  readonly tree: readonly TeamNode[];
}

/**
 * What the caller may manage in `orgId`, or `undefined` if they aren't a
 * member. `may(null)` is the top level: only org owners and admins.
 */
const authorityIn = async (
  db: Db,
  orgId: OrgId,
  userId: UserId
): Promise<TeamAuthority | undefined> => {
  const [orgRole, teams, adminOf] = await Promise.all([
    orgRoleOf(db, orgId, userId),
    loadTeams(db, orgId),
    teamAdminOf(db, orgId, userId),
  ]);
  if (!orgRole) {
    return;
  }
  const tree = toTree(teams);
  return {
    may: (teamId) =>
      teamId === null
        ? orgRole === "owner" || orgRole === "admin"
        : canManageTeam({ orgRole, teamAdminOf: adminOf, teamId, tree }),
    tree,
  };
};

const memberView = async (db: Db, teamId: TeamId, userId: UserId) => {
  const [row] = await db
    .select({ teamMember, user })
    .from(teamMember)
    .innerJoin(user, eq(user.id, teamMember.userId))
    .where(and(eq(teamMember.teamId, teamId), eq(teamMember.userId, userId)));
  if (!row) {
    throw new Error("team member vanished");
  }
  return {
    addedAt: row.teamMember.addedAt.toISOString(),
    role: teamRoleSchema.parse(row.teamMember.role),
    teamId,
    user: toUserSummary(row.user),
  };
};

export const teams = {
  addMember: authed.teams.addMember.handler(
    async ({ context, errors, input }) => {
      const found = await loadTeam(context.db, input.teamId);
      const authority =
        found && (await authorityIn(context.db, found.orgId, context.userId));
      if (!(found && authority)) {
        throw errors.NOT_FOUND();
      }
      if (!authority.may(found.id)) {
        throw errors.FORBIDDEN();
      }
      const [inOrg] = await context.db
        .select({ id: member.id })
        .from(member)
        .where(
          and(
            eq(member.organizationId, found.orgId),
            eq(member.userId, input.userId)
          )
        );
      if (!inOrg) {
        throw errors.VALIDATION({
          data: {
            issues: [
              {
                message: "only org members can join its teams",
                path: ["userId"],
              },
            ],
          },
        });
      }
      await context.db
        .insert(teamMember)
        .values({ role: input.role, teamId: found.id, userId: input.userId })
        .onConflictDoUpdate({
          set: { role: input.role },
          target: [teamMember.teamId, teamMember.userId],
        });
      return memberView(context.db, found.id, input.userId);
    }
  ),

  create: authed.teams.create.handler(async ({ context, errors, input }) => {
    const authority = await authorityIn(
      context.db,
      input.orgId,
      context.userId
    );
    if (!authority) {
      throw errors.NOT_FOUND();
    }
    if (
      input.parentId !== null &&
      !authority.tree.some((node) => node.id === input.parentId)
    ) {
      throw errors.VALIDATION({
        data: {
          issues: [
            {
              message: "the parent team must be in this org",
              path: ["parentId"],
            },
          ],
        },
      });
    }
    if (!authority.may(input.parentId)) {
      throw errors.FORBIDDEN();
    }
    const [row] = await context.db
      .insert(team)
      .values({
        name: input.name,
        orgId: input.orgId,
        parentId: input.parentId,
      })
      .returning();
    if (!row) {
      throw new Error("team insert returned no row");
    }
    return toTeam(row);
  }),

  delete: authed.teams.delete.handler(async ({ context, errors, input }) => {
    const found = await loadTeam(context.db, input.id);
    const authority =
      found && (await authorityIn(context.db, found.orgId, context.userId));
    if (!(found && authority)) {
      throw errors.NOT_FOUND();
    }
    // Removing a team is its parent's decision (or the org's, at the top).
    if (!authority.may(found.parentId)) {
      throw errors.FORBIDDEN();
    }
    if (authority.tree.some((node) => node.parentId === found.id)) {
      throw errors.CONFLICT({ data: { reason: "not_empty" } });
    }
    await context.db.transaction(async (tx) => {
      // Grants are polymorphic, so nothing cascades to the team's own.
      await tx
        .delete(resourceGrant)
        .where(
          and(
            eq(resourceGrant.principalType, "team"),
            eq(resourceGrant.principalId, found.id)
          )
        );
      await tx.delete(team).where(eq(team.id, found.id));
    });
  }),

  list: authed.teams.list.handler(async ({ context, errors, input }) => {
    const role = await orgRoleOf(context.db, input.orgId, context.userId);
    if (!role) {
      throw errors.NOT_FOUND();
    }
    const rows = await loadTeams(context.db, input.orgId);
    return rows.map(toTeam);
  }),

  members: authed.teams.members.handler(async ({ context, errors, input }) => {
    const found = await loadTeam(context.db, input.id);
    const role =
      found && (await orgRoleOf(context.db, found.orgId, context.userId));
    if (!(found && role)) {
      throw errors.NOT_FOUND();
    }
    const rows = await context.db
      .select({ teamMember, user })
      .from(teamMember)
      .innerJoin(user, eq(user.id, teamMember.userId))
      .where(eq(teamMember.teamId, found.id))
      .orderBy(asc(teamMember.addedAt), asc(user.id));
    return rows.map((row) => ({
      addedAt: row.teamMember.addedAt.toISOString(),
      role: teamRoleSchema.parse(row.teamMember.role),
      teamId: found.id,
      user: toUserSummary(row.user),
    }));
  }),

  removeMember: authed.teams.removeMember.handler(
    async ({ context, errors, input }) => {
      const found = await loadTeam(context.db, input.teamId);
      const authority =
        found && (await authorityIn(context.db, found.orgId, context.userId));
      if (!(found && authority)) {
        throw errors.NOT_FOUND();
      }
      // Anyone may leave a team; removing someone else takes authority.
      if (input.userId !== context.userId && !authority.may(found.id)) {
        throw errors.FORBIDDEN();
      }
      await context.db
        .delete(teamMember)
        .where(
          and(
            eq(teamMember.teamId, found.id),
            eq(teamMember.userId, input.userId)
          )
        );
    }
  ),

  update: authed.teams.update.handler(async ({ context, errors, input }) => {
    const found = await loadTeam(context.db, input.id);
    const authority =
      found && (await authorityIn(context.db, found.orgId, context.userId));
    if (!(found && authority)) {
      throw errors.NOT_FOUND();
    }
    if (!authority.may(found.id)) {
      throw errors.FORBIDDEN();
    }
    const moving =
      input.parentId !== undefined && input.parentId !== found.parentId;
    if (moving) {
      const parentId = input.parentId ?? null;
      if (
        parentId !== null &&
        !authority.tree.some((node) => node.id === parentId)
      ) {
        throw errors.VALIDATION({
          data: {
            issues: [
              {
                message: "the parent team must be in this org",
                path: ["parentId"],
              },
            ],
          },
        });
      }
      if (wouldCreateCycle(found.id, parentId, authority.tree)) {
        throw errors.CONFLICT({ data: { reason: "team_cycle" } });
      }
      // Moving takes authority where the team lands, not just where it is.
      if (!(authority.may(parentId) && authority.may(found.parentId))) {
        throw errors.FORBIDDEN();
      }
    }
    const [row] = await context.db
      .update(team)
      .set({
        ...(input.name === undefined ? {} : { name: input.name }),
        ...(moving ? { parentId: input.parentId ?? null } : {}),
      })
      .where(eq(team.id, found.id))
      .returning();
    if (!row) {
      throw errors.NOT_FOUND();
    }
    return toTeam(row);
  }),
};
