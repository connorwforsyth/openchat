import { strongestOrgRole } from "@workspace/auth/access";
import { orgRoleOf, teamAdminOf } from "@workspace/auth/resources";
import type { OrgId, TeamId, UserId } from "@workspace/contract/schemas/common";
import type { Db } from "@workspace/db/client";
import { teamAncestors, teamSubtree } from "@workspace/db/queries/teams";
import { member, user } from "@workspace/db/schema/auth";
import { team, teamMember } from "@workspace/db/schema/tenancy";
import { and, eq, inArray } from "drizzle-orm";

// Who administers what (D17), for the admin-facing procedures: keys, usage,
// budgets and the Decider log. Org owners and admins administer everything
// in their org; a team admin administers their team and its sub-teams
// (access flows down the tree); an instance admin is Better Auth's admin
// plugin role.

/**
 * The admin plugin stores roles comma-separated; `admin` among them makes
 * an instance admin. The same rule `me.get` uses for `isAdmin`.
 */
export const isInstanceAdmin = async (
  db: Db,
  userId: UserId
): Promise<boolean> => {
  const [row] = await db
    .select({ role: user.role })
    .from(user)
    .where(eq(user.id, userId));
  return (row?.role ?? "").split(",").some((each) => each.trim() === "admin");
};

export const isOrgAdmin = async (
  db: Db,
  orgId: OrgId,
  userId: UserId
): Promise<boolean> => {
  const role = await orgRoleOf(db, orgId, userId);
  return role === "owner" || role === "admin";
};

/** Orgs where the user is an owner or admin. */
export const administeredOrgs = async (
  db: Db,
  userId: UserId
): Promise<OrgId[]> => {
  const rows = await db
    .select({ id: member.organizationId, role: member.role })
    .from(member)
    .where(eq(member.userId, userId));
  return rows
    .filter((row) => {
      const role = strongestOrgRole(row.role);
      return role === "owner" || role === "admin";
    })
    .map((row) => row.id);
};

/** The team's org, or `null` when the team doesn't exist. */
export const teamOrg = async (
  db: Db,
  teamId: TeamId
): Promise<OrgId | null> => {
  const [row] = await db
    .select({ orgId: team.orgId })
    .from(team)
    .where(eq(team.id, teamId));
  return row?.orgId ?? null;
};

/**
 * Whether the user administers the team: an owner or admin of its org, or a
 * team admin of it or of any team above it.
 */
export const administersTeam = async (
  db: Db,
  teamId: TeamId,
  userId: UserId
): Promise<boolean> => {
  const orgId = await teamOrg(db, teamId);
  if (!orgId) {
    return false;
  }
  if (await isOrgAdmin(db, orgId, userId)) {
    return true;
  }
  const [adminOf, lineage] = await Promise.all([
    teamAdminOf(db, orgId, userId),
    teamAncestors(db, [teamId]),
  ]);
  const held = new Set<TeamId>(adminOf);
  return lineage.some((id) => held.has(id));
};

/**
 * Every team the user administers: each team in an org they administer,
 * and each team they're a team admin of plus its sub-teams.
 */
export const administeredTeams = async (
  db: Db,
  userId: UserId
): Promise<TeamId[]> => {
  const orgs = await administeredOrgs(db, userId);
  const [inOrgs, adminRows] = await Promise.all([
    orgs.length === 0
      ? []
      : db.select({ id: team.id }).from(team).where(inArray(team.orgId, orgs)),
    db
      .select({ id: teamMember.teamId })
      .from(teamMember)
      .where(and(eq(teamMember.userId, userId), eq(teamMember.role, "admin"))),
  ]);
  const subtrees = await Promise.all(
    adminRows.map((row) => teamSubtree(db, row.id))
  );
  return [...new Set([...inOrgs.map((row) => row.id), ...subtrees.flat()])];
};
