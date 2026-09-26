import type { OrgId, TeamId, UserId } from "@workspace/contract/schemas/common";
import type { Principal } from "@workspace/contract/schemas/tenancy";
import { and, asc, eq, sql } from "drizzle-orm";

import type { Db } from "../client";
import { member, organization } from "../schema/auth";
import { team, teamMember } from "../schema/tenancy";
import { rowsOf } from "./page";

// The team tree (D17). Access flows down (a grant to Engineering covers
// Engineering › Platform), so a member of Platform acts as Engineering too;
// usage rolls up the same tree the other way.

/** The given teams and every ancestor of each, without duplicates. */
export const teamAncestors = async (
  db: Db,
  teamIds: readonly TeamId[]
): Promise<TeamId[]> => {
  if (teamIds.length === 0) {
    return [];
  }
  const rows = rowsOf<{ id: TeamId }>(
    await db.execute(sql`
      with recursive up as (
        select ${team.id} as id, ${team.parentId} as parent_id
        from ${team}
        where ${team.id} in (${sql.join(
          teamIds.map((id) => sql`${id}`),
          sql`, `
        )})
        union
        select t.id, t.parent_id
        from ${team} t
        join up on t.id = up.parent_id
      )
      select id from up
    `)
  );
  return rows.map((row) => row.id);
};

/** A team and every team below it. */
export const teamSubtree = async (
  db: Db,
  teamId: TeamId
): Promise<TeamId[]> => {
  const rows = rowsOf<{ id: TeamId }>(
    await db.execute(sql`
      with recursive down as (
        select ${team.id} as id from ${team} where ${team.id} = ${teamId}
        union
        select t.id from ${team} t join down on t.parent_id = down.id
      )
      select id from down
    `)
  );
  return rows.map((row) => row.id);
};

/**
 * Everyone a user acts as when access is checked: themselves, each org they
 * belong to, and each team they're in plus that team's ancestors.
 * `effectiveGrants` (ticket 012) matches grants against this set.
 */
export const loadPrincipals = async (
  db: Db,
  userId: UserId
): Promise<Principal[]> => {
  const [orgs, teams] = await Promise.all([
    db
      .select({ id: member.organizationId })
      .from(member)
      .where(eq(member.userId, userId)),
    db
      .select({ id: teamMember.teamId })
      .from(teamMember)
      .where(eq(teamMember.userId, userId)),
  ]);
  const teamIds = await teamAncestors(
    db,
    teams.map((row) => row.id)
  );
  return [
    { id: userId, type: "user" },
    ...orgs.map((row): Principal => ({ id: row.id, type: "org" })),
    ...teamIds.map((id): Principal => ({ id, type: "team" })),
  ];
};

// --- Added for chat contexts (ticket 014) ---

/**
 * A user's personal org: where the Personal context keeps its usage and keys
 * (D17). `null` until one exists (sign-up creates it, ticket 012).
 */
export const personalOrgOf = async (
  db: Db,
  userId: UserId
): Promise<OrgId | null> => {
  const [row] = await db
    .select({ id: organization.id })
    .from(organization)
    .innerJoin(member, eq(member.organizationId, organization.id))
    .where(and(eq(member.userId, userId), eq(organization.isPersonal, true)))
    .orderBy(asc(organization.createdAt))
    .limit(1);
  return row?.id ?? null;
};

/**
 * A team's org and its path to the top: the team first, then its parent, up
 * to the top-level team (the order key resolution walks, D17).
 */
export const teamLineage = async (
  db: Db,
  teamId: TeamId
): Promise<{ readonly orgId: OrgId; readonly path: TeamId[] } | null> => {
  const rows = rowsOf<{ depth: number; id: TeamId; org_id: OrgId }>(
    await db.execute(sql`
      with recursive up as (
        select ${team.id} as id, ${team.parentId} as parent_id, ${team.orgId} as org_id, 0 as depth
        from ${team}
        where ${team.id} = ${teamId}
        union all
        select t.id, t.parent_id, t.org_id, up.depth + 1
        from ${team} t
        join up on t.id = up.parent_id
      )
      select id, org_id, depth from up order by depth
    `)
  );
  const [first] = rows;
  return first
    ? { orgId: first.org_id, path: rows.map((row) => row.id) }
    : null;
};
