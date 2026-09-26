import type {
  InvitationId,
  OrgId,
  UserId,
} from "@workspace/contract/schemas/common";
import type { Db } from "@workspace/db/client";
import {
  invitation,
  member,
  organization,
  user,
} from "@workspace/db/schema/auth";
import { invitationTeam, team, teamMember } from "@workspace/db/schema/tenancy";
import { and, asc, eq, gt, inArray, sql } from "drizzle-orm";

// The database side of sign-up and membership: the facts the sign-up policy
// needs, and what happens around Better Auth's own writes (a personal org
// for every new user, the first user as instance admin, our team tree kept
// in step with org membership).

/** No user exists yet. */
export const isFirstUser = async (db: Db): Promise<boolean> => {
  const [row] = await db.select({ id: user.id }).from(user).limit(1);
  return row === undefined;
};

/** A pending, unexpired invitation to any org exists for `email`. */
export const hasPendingInvitation = async (
  db: Db,
  email: string,
  now: Date = new Date()
): Promise<boolean> => {
  const [row] = await db
    .select({ id: invitation.id })
    .from(invitation)
    .where(
      and(
        sql`lower(${invitation.email}) = ${email.trim().toLowerCase()}`,
        eq(invitation.status, "pending"),
        gt(invitation.expiresAt, now)
      )
    )
    .limit(1);
  return row !== undefined;
};

/** The personal org's slug: unique per user and never a name someone would pick. */
export const personalSlug = (userId: UserId): string =>
  `personal-${userId.replaceAll("-", "")}`;

/**
 * Runs once per new user, after Better Auth has committed the row: creates
 * their hidden personal org (D17), and makes the earliest user the instance
 * admin (D22). "Earliest" rather than "no one else yet" so two sign-ups
 * racing on an empty instance still end with exactly one admin: ids are
 * UUIDv7, so the smallest belongs to whoever was created first.
 */
export const bootstrapUser = async (
  db: Db,
  created: { readonly id: UserId; readonly name: string }
): Promise<void> => {
  await db.transaction(async (tx) => {
    const [org] = await tx
      .insert(organization)
      .values({
        isPersonal: true,
        name: created.name,
        slug: personalSlug(created.id),
      })
      .returning({ id: organization.id });
    if (!org) {
      throw new Error("personal org insert returned no row");
    }
    await tx
      .insert(member)
      .values({ organizationId: org.id, role: "owner", userId: created.id });

    const [earliest] = await tx
      .select({ id: user.id })
      .from(user)
      .orderBy(asc(user.createdAt), asc(user.id))
      .limit(1);
    if (earliest?.id === created.id) {
      // The guard covers the one ordering the check above can't: an earlier
      // id committed after a later user already promoted themselves.
      await tx
        .update(user)
        .set({ role: "admin" })
        .where(
          and(
            eq(user.id, created.id),
            sql`not exists (select 1 from ${user} where ${user.role} = 'admin')`
          )
        );
    }
  });
};

/** The caller's personal org. Every user has one from sign-up on. */
export const findPersonalOrgId = async (
  db: Db,
  userId: UserId
): Promise<OrgId | undefined> => {
  const [row] = await db
    .select({ id: organization.id })
    .from(organization)
    .innerJoin(member, eq(member.organizationId, organization.id))
    .where(and(eq(member.userId, userId), eq(organization.isPersonal, true)))
    .orderBy(asc(organization.createdAt))
    .limit(1);
  return row?.id;
};

export const isPersonalOrg = async (
  db: Db,
  orgId: string
): Promise<boolean> => {
  const [row] = await db
    .select({ isPersonal: organization.isPersonal })
    .from(organization)
    .where(eq(organization.id, orgId as OrgId));
  return row?.isPersonal ?? false;
};

/** On accepting an invitation, join the teams it named (ours, not Better Auth's flat ones). */
export const joinInvitedTeams = async (
  db: Db,
  invitationId: InvitationId,
  userId: UserId
): Promise<void> => {
  const rows = await db
    .select({ teamId: invitationTeam.teamId })
    .from(invitationTeam)
    .where(eq(invitationTeam.invitationId, invitationId));
  if (rows.length === 0) {
    return;
  }
  await db
    .insert(teamMember)
    .values(rows.map((row) => ({ role: "member", teamId: row.teamId, userId })))
    .onConflictDoNothing();
};

/** Leaving an org (or being removed) leaves every team in it too. */
export const leaveOrgTeams = async (
  db: Db,
  orgId: OrgId,
  userId: UserId
): Promise<void> => {
  const teamIds = db
    .select({ id: team.id })
    .from(team)
    .where(eq(team.orgId, orgId));
  await db
    .delete(teamMember)
    .where(
      and(eq(teamMember.userId, userId), inArray(teamMember.teamId, teamIds))
    );
};
