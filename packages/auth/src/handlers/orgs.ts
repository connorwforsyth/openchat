import { clampOrgPolicy } from "@workspace/config/policy";
import type {
  InvitationId,
  OrgId,
  TeamId,
  UserId,
} from "@workspace/contract/schemas/common";
import type {
  OrgPolicy,
  OrgPolicyView,
  OrgRole,
} from "@workspace/contract/schemas/tenancy";
import type { Db } from "@workspace/db/client";
import { decodeCursor, toPage } from "@workspace/db/queries/page";
import {
  invitation,
  member,
  organization,
  user,
} from "@workspace/db/schema/auth";
import {
  invitationTeam,
  invitationToken,
  orgSettings,
  team,
  teamMember,
} from "@workspace/db/schema/tenancy";
import { and, asc, desc, eq, ilike, inArray, ne, or, sql } from "drizzle-orm";

import { strongestOrgRole } from "../access";
import { hashInvitationToken, newInvitationToken } from "../invitation-token";
import { loadOrgPolicy, orgRoleOf } from "../resources";
import { leaveOrgTeams } from "../store";
import { authed } from "./base";
import {
  type AuthRefusal,
  type HandlerContext,
  nowOf,
  viaAuth,
} from "./context";
import { toInvitation, toOrg, toUserSummary } from "./views";

// Orgs, members and invitations (D17). Writes go through Better Auth's
// organization plugin, so its role checks and hooks apply however an org is
// changed (ticket 008); reads come straight from the database, in our
// shapes. Non-members get `NOT_FOUND`, never a hint that the org exists.

const isAdminRole = (role: OrgRole | null): boolean =>
  role === "owner" || role === "admin";

const SLUG_TAKEN = new Set([
  "ORGANIZATION_ALREADY_EXISTS",
  "ORGANIZATION_SLUG_ALREADY_TAKEN",
]);
const ALREADY = new Set([
  "USER_IS_ALREADY_A_MEMBER_OF_THIS_ORGANIZATION",
  "USER_IS_ALREADY_INVITED_TO_THIS_ORGANIZATION",
]);
const LAST_OWNER = new Set([
  "YOU_CANNOT_LEAVE_THE_ORGANIZATION_AS_THE_ONLY_OWNER",
  "YOU_CANNOT_LEAVE_THE_ORGANIZATION_WITHOUT_AN_OWNER",
]);

/** The typed error for a Better Auth refusal nothing more specific covers. */
const refusalError = (
  refusal: AuthRefusal,
  errors: {
    readonly FORBIDDEN: () => Error;
    readonly NOT_FOUND: () => Error;
  }
): Error => {
  if (refusal.code.endsWith("_NOT_FOUND") || refusal.status === "NOT_FOUND") {
    return errors.NOT_FOUND();
  }
  if (refusal.status === "FORBIDDEN" || refusal.status === "UNAUTHORIZED") {
    return errors.FORBIDDEN();
  }
  // Anything else means we sent Better Auth something the contract should
  // have ruled out: a bug, caught once at the shell.
  return new Error(`Better Auth refused: ${refusal.status} ${refusal.code}`);
};

const loadOrgRow = async (db: Db, id: OrgId) => {
  const [row] = await db
    .select()
    .from(organization)
    .where(eq(organization.id, id));
  return row;
};

/** The org and the caller's role in it, or `undefined` for a non-member. */
const orgForMember = async (db: Db, orgId: OrgId, userId: UserId) => {
  const [row, role] = await Promise.all([
    loadOrgRow(db, orgId),
    orgRoleOf(db, orgId, userId),
  ]);
  return row && role ? { role, row } : undefined;
};

const ownerCount = async (db: Db, orgId: OrgId): Promise<number> => {
  const rows = await db
    .select({ role: member.role })
    .from(member)
    .where(eq(member.organizationId, orgId));
  return rows.filter((row) => strongestOrgRole(row.role) === "owner").length;
};

const memberRow = async (db: Db, orgId: OrgId, userId: UserId) => {
  const [row] = await db
    .select()
    .from(member)
    .where(and(eq(member.organizationId, orgId), eq(member.userId, userId)));
  return row;
};

/** Direct team memberships in `orgId`, per user. */
const teamIdsByUser = async (
  db: Db,
  orgId: OrgId,
  userIds: readonly UserId[]
): Promise<Map<UserId, TeamId[]>> => {
  const byUser = new Map<UserId, TeamId[]>();
  if (userIds.length === 0) {
    return byUser;
  }
  const rows = await db
    .select({ teamId: teamMember.teamId, userId: teamMember.userId })
    .from(teamMember)
    .innerJoin(team, eq(team.id, teamMember.teamId))
    .where(and(eq(team.orgId, orgId), inArray(teamMember.userId, [...userIds])))
    .orderBy(asc(team.createdAt));
  for (const row of rows) {
    byUser.set(row.userId, [...(byUser.get(row.userId) ?? []), row.teamId]);
  }
  return byUser;
};

const teamIdsByInvitation = async (
  db: Db,
  invitationIds: readonly InvitationId[]
): Promise<Map<InvitationId, TeamId[]>> => {
  const byInvitation = new Map<InvitationId, TeamId[]>();
  if (invitationIds.length === 0) {
    return byInvitation;
  }
  const rows = await db
    .select()
    .from(invitationTeam)
    .where(inArray(invitationTeam.invitationId, [...invitationIds]));
  for (const row of rows) {
    byInvitation.set(row.invitationId, [
      ...(byInvitation.get(row.invitationId) ?? []),
      row.teamId,
    ]);
  }
  return byInvitation;
};

const memberView = async (db: Db, orgId: OrgId, userId: UserId) => {
  const [row] = await db
    .select({ member, user })
    .from(member)
    .innerJoin(user, eq(user.id, member.userId))
    .where(and(eq(member.organizationId, orgId), eq(member.userId, userId)));
  if (!row) {
    return;
  }
  const teams = await teamIdsByUser(db, orgId, [userId]);
  return {
    joinedAt: row.member.createdAt.toISOString(),
    orgId,
    role: strongestOrgRole(row.member.role) ?? "member",
    teamIds: teams.get(userId) ?? [],
    user: toUserSummary(row.user),
  };
};

/** The invitation a link's token opens, or `undefined` for an unknown one. */
const invitationForToken = async (
  db: Db,
  token: string
): Promise<InvitationId | undefined> => {
  const [row] = await db
    .select({ id: invitationToken.invitationId })
    .from(invitationToken)
    .where(eq(invitationToken.tokenHash, hashInvitationToken(token)));
  return row?.id;
};

// --- Policy (D18: the YAML sets limits, each org chooses within them) ---

const policyView = (
  context: HandlerContext,
  stored: OrgPolicy
): OrgPolicyView => {
  const clamped = clampOrgPolicy(stored, context.config.policies);
  return {
    adjustments: [...clamped.adjustments],
    effective: clamped.effective,
    limits: context.config.policies,
    stored,
  };
};

export const orgs = {
  acceptInvitation: authed.orgs.acceptInvitation.handler(
    async ({ context, errors, input }) => {
      // `{ id }` is deprecated (042) and goes in the next contract release.
      const invitationId =
        "token" in input
          ? await invitationForToken(context.db, input.token)
          : input.id;
      if (!invitationId) {
        throw errors.NOT_FOUND();
      }
      const accepted = await viaAuth(() =>
        context.auth.api.acceptInvitation({
          body: { invitationId },
          headers: context.headers,
        })
      );
      if (!accepted.ok) {
        // An unknown, used or expired invitation all read as not found.
        throw accepted.error.code === "INVITATION_NOT_FOUND"
          ? errors.NOT_FOUND()
          : refusalError(accepted.error, errors);
      }
      const found = await orgForMember(
        context.db,
        accepted.value.member.organizationId as OrgId,
        context.userId
      );
      if (!found) {
        throw new Error("accepted an invitation but isn't a member");
      }
      // Used up: the invitation is `accepted` now, so the token is dead weight.
      await context.db
        .delete(invitationToken)
        .where(eq(invitationToken.invitationId, invitationId));
      return toOrg(found.row, found.role);
    }
  ),

  cancelInvitation: authed.orgs.cancelInvitation.handler(
    async ({ context, errors, input }) => {
      const [row] = await context.db
        .select({ id: invitation.id })
        .from(invitation)
        .where(
          and(
            eq(invitation.id, input.id),
            eq(invitation.organizationId, input.orgId)
          )
        );
      const role = await orgRoleOf(context.db, input.orgId, context.userId);
      if (!(row && role)) {
        throw errors.NOT_FOUND();
      }
      const canceled = await viaAuth(() =>
        context.auth.api.cancelInvitation({
          body: { invitationId: input.id },
          headers: context.headers,
        })
      );
      if (!canceled.ok) {
        throw refusalError(canceled.error, errors);
      }
    }
  ),

  create: authed.orgs.create.handler(async ({ context, errors, input }) => {
    const created = await viaAuth(() =>
      context.auth.api.createOrganization({
        body: { name: input.name, slug: input.slug },
        headers: context.headers,
      })
    );
    if (!created.ok) {
      throw SLUG_TAKEN.has(created.error.code)
        ? errors.CONFLICT({ data: { reason: "already_exists" } })
        : refusalError(created.error, errors);
    }
    const row = await loadOrgRow(context.db, created.value.id as OrgId);
    if (!row) {
      throw new Error("created an org that isn't there");
    }
    return toOrg(row, "owner");
  }),

  delete: authed.orgs.delete.handler(async ({ context, errors, input }) => {
    const found = await orgForMember(context.db, input.id, context.userId);
    if (!found) {
      throw errors.NOT_FOUND();
    }
    if (found.row.isPersonal || found.role !== "owner") {
      throw errors.FORBIDDEN();
    }
    const deleted = await viaAuth(() =>
      context.auth.api.deleteOrganization({
        body: { organizationId: input.id },
        headers: context.headers,
      })
    );
    if (!deleted.ok) {
      throw refusalError(deleted.error, errors);
    }
  }),

  get: authed.orgs.get.handler(async ({ context, errors, input }) => {
    const found = await orgForMember(context.db, input.id, context.userId);
    if (!found) {
      throw errors.NOT_FOUND();
    }
    return toOrg(found.row, found.role);
  }),

  getPolicy: authed.orgs.getPolicy.handler(
    async ({ context, errors, input }) => {
      // Every member may read it: members are told when audit is on (D17).
      const role = await orgRoleOf(context.db, input.id, context.userId);
      if (!role) {
        throw errors.NOT_FOUND();
      }
      return policyView(context, await loadOrgPolicy(context.db, input.id));
    }
  ),

  invite: authed.orgs.invite.handler(async ({ context, errors, input }) => {
    const found = await orgForMember(context.db, input.orgId, context.userId);
    if (!found) {
      throw errors.NOT_FOUND();
    }
    if (found.row.isPersonal || !isAdminRole(found.role)) {
      throw errors.FORBIDDEN();
    }
    const teamIds = [...new Set(input.teamIds)];
    if (teamIds.length > 0) {
      const inOrg = await context.db
        .select({ id: team.id })
        .from(team)
        .where(and(eq(team.orgId, input.orgId), inArray(team.id, teamIds)));
      if (inOrg.length !== teamIds.length) {
        throw errors.VALIDATION({
          data: {
            issues: [
              { message: "every team must be in this org", path: ["teamIds"] },
            ],
          },
        });
      }
    }
    const created = await viaAuth(() =>
      context.auth.api.createInvitation({
        body: {
          email: input.email,
          organizationId: input.orgId,
          role: input.role,
        },
        headers: context.headers,
      })
    );
    if (!created.ok) {
      throw ALREADY.has(created.error.code)
        ? errors.CONFLICT({ data: { reason: "already_exists" } })
        : refusalError(created.error, errors);
    }
    const invitationId = created.value.id as InvitationId;
    const token = newInvitationToken();
    await context.db
      .insert(invitationToken)
      .values({ invitationId, tokenHash: hashInvitationToken(token) });
    if (teamIds.length > 0) {
      await context.db
        .insert(invitationTeam)
        .values(teamIds.map((teamId) => ({ invitationId, teamId })))
        .onConflictDoNothing();
    }
    const [row] = await context.db
      .select()
      .from(invitation)
      .where(eq(invitation.id, invitationId));
    if (!row) {
      throw new Error("created an invitation that isn't there");
    }
    // The only time the token leaves the server: it's stored hashed.
    return { ...toInvitation(row, teamIds, nowOf(context)), token };
  }),

  leave: authed.orgs.leave.handler(async ({ context, errors, input }) => {
    const found = await orgForMember(context.db, input.id, context.userId);
    if (!found) {
      throw errors.NOT_FOUND();
    }
    if (found.row.isPersonal) {
      throw errors.FORBIDDEN();
    }
    if (
      found.role === "owner" &&
      (await ownerCount(context.db, input.id)) <= 1
    ) {
      throw errors.CONFLICT({ data: { reason: "last_owner" } });
    }
    const left = await viaAuth(() =>
      context.auth.api.leaveOrganization({
        body: { organizationId: input.id },
        headers: context.headers,
      })
    );
    if (!left.ok) {
      throw LAST_OWNER.has(left.error.code)
        ? errors.CONFLICT({ data: { reason: "last_owner" } })
        : refusalError(left.error, errors);
    }
    await leaveOrgTeams(context.db, input.id, context.userId);
  }),

  list: authed.orgs.list.handler(async ({ context }) => {
    const rows = await context.db
      .select({ member, organization })
      .from(member)
      .innerJoin(organization, eq(organization.id, member.organizationId))
      .where(
        and(
          eq(member.userId, context.userId),
          eq(organization.isPersonal, false)
        )
      )
      .orderBy(asc(organization.name), asc(organization.id));
    return rows.map((row) =>
      toOrg(row.organization, strongestOrgRole(row.member.role) ?? "member")
    );
  }),

  listInvitations: authed.orgs.listInvitations.handler(
    async ({ context, errors, input }) => {
      const role = await orgRoleOf(context.db, input.orgId, context.userId);
      if (!role) {
        throw errors.NOT_FOUND();
      }
      if (!isAdminRole(role)) {
        throw errors.FORBIDDEN();
      }
      const rows = await context.db
        .select()
        .from(invitation)
        .where(eq(invitation.organizationId, input.orgId))
        .orderBy(desc(invitation.createdAt), desc(invitation.id));
      const teams = await teamIdsByInvitation(
        context.db,
        rows.map((row) => row.id)
      );
      const now = nowOf(context);
      return rows.map((row) => toInvitation(row, teams.get(row.id) ?? [], now));
    }
  ),

  members: authed.orgs.members.handler(async ({ context, errors, input }) => {
    const role = await orgRoleOf(context.db, input.orgId, context.userId);
    if (!role) {
      throw errors.NOT_FOUND();
    }
    const cursor = input.cursor ? decodeCursor(input.cursor) : undefined;
    if (cursor && !cursor.ok) {
      throw errors.VALIDATION({
        data: { issues: [{ message: "invalid cursor", path: ["cursor"] }] },
      });
    }
    const pattern = input.query
      ? `%${input.query.replaceAll(/[\\%_]/g, (char) => `\\${char}`)}%`
      : undefined;
    const rows = await context.db
      .select({ member, user })
      .from(member)
      .innerJoin(user, eq(user.id, member.userId))
      .where(
        and(
          eq(member.organizationId, input.orgId),
          pattern
            ? or(ilike(user.name, pattern), ilike(user.email, pattern))
            : undefined,
          cursor?.ok
            ? sql`(${member.createdAt}, ${member.id}) > (${String(cursor.value.key)}::timestamptz, ${cursor.value.id}::uuid)`
            : undefined
        )
      )
      .orderBy(asc(member.createdAt), asc(member.id))
      .limit(input.limit + 1);
    const page = toPage(rows, input.limit, (row) => ({
      id: row.member.id,
      key: row.member.createdAt.toISOString(),
    }));
    const teams = await teamIdsByUser(
      context.db,
      input.orgId,
      page.items.map((row) => row.user.id)
    );
    return {
      items: page.items.map((row) => ({
        joinedAt: row.member.createdAt.toISOString(),
        orgId: input.orgId,
        role: strongestOrgRole(row.member.role) ?? "member",
        teamIds: teams.get(row.user.id) ?? [],
        user: toUserSummary(row.user),
      })),
      nextCursor: page.nextCursor,
    };
  }),

  removeMember: authed.orgs.removeMember.handler(
    async ({ context, errors, input }) => {
      const role = await orgRoleOf(context.db, input.orgId, context.userId);
      const target = await memberRow(context.db, input.orgId, input.userId);
      if (!(role && target)) {
        throw errors.NOT_FOUND();
      }
      if (!isAdminRole(role)) {
        throw errors.FORBIDDEN();
      }
      if (
        strongestOrgRole(target.role) === "owner" &&
        (await ownerCount(context.db, input.orgId)) <= 1
      ) {
        throw errors.CONFLICT({ data: { reason: "last_owner" } });
      }
      const removed = await viaAuth(() =>
        context.auth.api.removeMember({
          body: { memberIdOrEmail: target.id, organizationId: input.orgId },
          headers: context.headers,
        })
      );
      if (!removed.ok) {
        throw LAST_OWNER.has(removed.error.code)
          ? errors.CONFLICT({ data: { reason: "last_owner" } })
          : refusalError(removed.error, errors);
      }
      // The plugin's hook does this too; doing it here keeps our tree right
      // even if a Better Auth version stops calling it for this path.
      await leaveOrgTeams(context.db, input.orgId, input.userId);
    }
  ),

  update: authed.orgs.update.handler(async ({ context, errors, input }) => {
    const found = await orgForMember(context.db, input.id, context.userId);
    if (!found) {
      throw errors.NOT_FOUND();
    }
    if (!isAdminRole(found.role)) {
      throw errors.FORBIDDEN();
    }
    if (input.slug !== undefined && input.slug !== found.row.slug) {
      const [taken] = await context.db
        .select({ id: organization.id })
        .from(organization)
        .where(
          and(eq(organization.slug, input.slug), ne(organization.id, input.id))
        );
      if (taken) {
        throw errors.CONFLICT({ data: { reason: "already_exists" } });
      }
    }
    const updated = await viaAuth(() =>
      context.auth.api.updateOrganization({
        body: {
          data: {
            ...(input.name === undefined ? {} : { name: input.name }),
            ...(input.slug === undefined ? {} : { slug: input.slug }),
            ...(input.logoUrl === undefined
              ? {}
              : { logo: input.logoUrl ?? undefined }),
          },
          organizationId: input.id,
        },
        headers: context.headers,
      })
    );
    if (!updated.ok) {
      throw SLUG_TAKEN.has(updated.error.code)
        ? errors.CONFLICT({ data: { reason: "already_exists" } })
        : refusalError(updated.error, errors);
    }
    if (input.logoUrl === null) {
      // Better Auth's update can't clear a field, only set one.
      await context.db
        .update(organization)
        .set({ logo: null })
        .where(eq(organization.id, input.id));
    }
    const row = await loadOrgRow(context.db, input.id);
    if (!row) {
      throw errors.NOT_FOUND();
    }
    return toOrg(row, found.role);
  }),

  updateMember: authed.orgs.updateMember.handler(
    async ({ context, errors, input }) => {
      const role = await orgRoleOf(context.db, input.orgId, context.userId);
      const target = await memberRow(context.db, input.orgId, input.userId);
      if (!(role && target)) {
        throw errors.NOT_FOUND();
      }
      if (!isAdminRole(role)) {
        throw errors.FORBIDDEN();
      }
      if (
        strongestOrgRole(target.role) === "owner" &&
        input.role !== "owner" &&
        (await ownerCount(context.db, input.orgId)) <= 1
      ) {
        throw errors.CONFLICT({ data: { reason: "last_owner" } });
      }
      const updated = await viaAuth(() =>
        context.auth.api.updateMemberRole({
          body: {
            memberId: target.id,
            organizationId: input.orgId,
            role: input.role,
          },
          headers: context.headers,
        })
      );
      if (!updated.ok) {
        throw LAST_OWNER.has(updated.error.code)
          ? errors.CONFLICT({ data: { reason: "last_owner" } })
          : refusalError(updated.error, errors);
      }
      const view = await memberView(context.db, input.orgId, input.userId);
      if (!view) {
        throw errors.NOT_FOUND();
      }
      return view;
    }
  ),

  updatePolicy: authed.orgs.updatePolicy.handler(
    async ({ context, errors, input }) => {
      const role = await orgRoleOf(context.db, input.id, context.userId);
      if (!role) {
        throw errors.NOT_FOUND();
      }
      if (!isAdminRole(role)) {
        throw errors.FORBIDDEN();
      }
      const current = await loadOrgPolicy(context.db, input.id);
      // Only the owner switches the audit policy (D17): it changes what
      // admins can read, so an admin can't grant it to themselves.
      if (
        input.policy.auditEnabled !== current.auditEnabled &&
        role !== "owner"
      ) {
        throw errors.FORBIDDEN();
      }
      const values = {
        auditEnabled: input.policy.auditEnabled,
        chatContexts: input.policy.chatContexts,
        persistClientCache: input.policy.persistClientCache,
        personalKeyFallback: input.policy.personalKeyFallback,
        publishGate: input.policy.publishGate,
        sampledScoring: input.policy.sampledScoring,
        updatedBy: context.userId,
      };
      await context.db
        .insert(orgSettings)
        .values({ orgId: input.id, ...values })
        .onConflictDoUpdate({ set: values, target: orgSettings.orgId });
      return policyView(context, input.policy);
    }
  ),
};
