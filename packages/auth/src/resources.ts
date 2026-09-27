import { clampOrgPolicy } from "@workspace/config/policy";
import type {
  ConversationId,
  LibraryItemId,
  OrgId,
  TeamId,
  UserId,
} from "@workspace/contract/schemas/common";
import type { ResourceRef } from "@workspace/contract/schemas/grants";
import {
  type InstancePolicy,
  type OrgPolicy,
  type OrgRole,
  orgPolicySchema,
  type Principal,
} from "@workspace/contract/schemas/tenancy";
import type { Db } from "@workspace/db/client";
import {
  type GrantRow,
  listGrantsForPrincipals,
} from "@workspace/db/queries/grants";
import { loadPrincipals } from "@workspace/db/queries/teams";
import { member } from "@workspace/db/schema/auth";
import { conversation } from "@workspace/db/schema/chat";
import {
  agent,
  mcpServer,
  preset,
  prompt,
  skill,
} from "@workspace/db/schema/library";
import { orgSettings, team, teamMember } from "@workspace/db/schema/tenancy";
import { err, ok, type Result } from "@workspace/shared/result";
import { and, asc, eq } from "drizzle-orm";

import {
  type AccessAction,
  type AccessQuery,
  type AdminVisibility,
  canAccess,
  type GrantFact,
  orgAdminVisibility,
  type ResourceFacts,
  strongestOrgRole,
  type TeamNode,
} from "./access";

// Loading the facts the pure access functions decide on. Grants are
// polymorphic (no foreign key), so finding who owns a resource means
// looking in the table its type names.

const libraryTables = {
  agent,
  mcp_server: mcpServer,
  preset,
  prompt,
  skill,
} as const;

/** Who owns the resource, or `undefined` if it doesn't exist. */
export const loadResourceFacts = async (
  db: Db,
  ref: ResourceRef
): Promise<ResourceFacts | undefined> => {
  if (ref.resourceType === "conversation") {
    const [row] = await db
      .select({ ownerId: conversation.ownerId })
      .from(conversation)
      .where(eq(conversation.id, ref.resourceId as ConversationId));
    return row
      ? {
          ownerId: row.ownerId,
          resourceId: ref.resourceId,
          resourceType: "conversation",
        }
      : undefined;
  }
  const table = libraryTables[ref.resourceType];
  const [row] = await db
    .select({
      maintainers: table.maintainers,
      ownerId: table.ownerId,
      ownerType: table.ownerType,
    })
    .from(table)
    .where(eq(table.id, ref.resourceId as LibraryItemId));
  if (!row) {
    return;
  }
  return {
    maintainers: row.maintainers,
    owner: { id: row.ownerId, type: row.ownerType } as Principal,
    resourceId: ref.resourceId,
    resourceType: ref.resourceType,
  };
};

/** The caller's role in an org, or `null` when they aren't a member. */
export const orgRoleOf = async (
  db: Db,
  orgId: OrgId,
  userId: UserId
): Promise<OrgRole | null> => {
  const [row] = await db
    .select({ role: member.role })
    .from(member)
    .where(and(eq(member.organizationId, orgId), eq(member.userId, userId)));
  return row ? strongestOrgRole(row.role) : null;
};

/** An org's team tree, oldest team first. */
export const loadTeams = (db: Db, orgId: OrgId) =>
  db
    .select()
    .from(team)
    .where(eq(team.orgId, orgId))
    .orderBy(asc(team.createdAt), asc(team.id));

export const toTree = (
  teams: readonly { id: TeamId; parentId: TeamId | null }[]
): TeamNode[] => teams.map(({ id, parentId }) => ({ id, parentId }));

/** Teams in `orgId` where the user is a team admin. */
export const teamAdminOf = async (
  db: Db,
  orgId: OrgId,
  userId: UserId
): Promise<TeamId[]> => {
  const rows = await db
    .select({ id: teamMember.teamId })
    .from(teamMember)
    .innerJoin(team, eq(team.id, teamMember.teamId))
    .where(
      and(
        eq(team.orgId, orgId),
        eq(teamMember.userId, userId),
        eq(teamMember.role, "admin")
      )
    );
  return rows.map((row) => row.id);
};

/** An org's stored policy choices; no row means every default. */
export const loadOrgPolicy = async (
  db: Db,
  orgId: OrgId
): Promise<OrgPolicy> => {
  const [row] = await db
    .select()
    .from(orgSettings)
    .where(eq(orgSettings.orgId, orgId));
  return orgPolicySchema.parse(
    row
      ? {
          auditEnabled: row.auditEnabled,
          chatContexts: row.chatContexts,
          persistClientCache: row.persistClientCache,
          personalKeyFallback: row.personalKeyFallback,
          publishGate: row.publishGate,
          sampledScoring: row.sampledScoring,
        }
      : {}
  );
};

/**
 * What the user sees of someone else's chat as an admin of the org its
 * context belongs to (D17): metadata, or content under the audit policy as
 * it applies after the instance limits.
 */
const chatAdminVisibility = async (
  db: Db,
  userId: UserId,
  conversationId: string,
  limits: InstancePolicy | undefined
): Promise<AdminVisibility> => {
  const [row] = await db
    .select({
      contextId: conversation.contextId,
      contextType: conversation.contextType,
      teamOrgId: team.orgId,
    })
    .from(conversation)
    .leftJoin(team, eq(team.id, conversation.contextId))
    .where(eq(conversation.id, conversationId as ConversationId));
  const orgId =
    row?.contextType === "team" ? row.teamOrgId : (row?.contextId as OrgId);
  if (!orgId) {
    return "none";
  }
  const role = await orgRoleOf(db, orgId, userId);
  if (role !== "owner" && role !== "admin") {
    return "none";
  }
  const stored = await loadOrgPolicy(db, orgId);
  const auditEnabled = limits
    ? clampOrgPolicy(stored, limits).effective.auditEnabled
    : false;
  return orgAdminVisibility({ auditEnabled, role });
};

const toFact = (row: GrantRow): GrantFact => ({
  permission: row.permission,
  principal: { id: row.principalId, type: row.principalType } as Principal,
  resourceId: row.resourceId,
  resourceType: row.resourceType,
});

/** Everything `canAccess` needs about a user and one resource, or `undefined` if it's gone. */
export const loadAccessQuery = async (
  db: Db,
  userId: UserId,
  ref: ResourceRef,
  /** The instance's policy limits (`config.policies`); without them audit never applies. */
  limits?: InstancePolicy
): Promise<AccessQuery | undefined> => {
  const resource = await loadResourceFacts(db, ref);
  if (!resource) {
    return;
  }
  const [principals, adminVisibility] = await Promise.all([
    loadPrincipals(db, userId),
    resource.resourceType === "conversation" && resource.ownerId !== userId
      ? chatAdminVisibility(db, userId, ref.resourceId, limits)
      : undefined,
  ]);
  const grants = await listGrantsForPrincipals(db, principals, {
    resourceIds: [ref.resourceId],
    resourceType: ref.resourceType,
  });
  return {
    adminVisibility,
    grants: grants.map(toFact),
    principals,
    resource,
    userId,
  };
};

/**
 * May `userId` do `action` to the resource? For every handler that touches
 * a chat or library item (014, 017): `not_found` when it doesn't exist,
 * `forbidden` when it does but the answer is no. Callers that must not
 * reveal existence answer both with `NOT_FOUND`.
 */
export const checkAccess = async (
  db: Db,
  userId: UserId,
  ref: ResourceRef,
  action: AccessAction,
  limits?: InstancePolicy
): Promise<Result<AccessQuery, "forbidden" | "not_found">> => {
  const query = await loadAccessQuery(db, userId, ref, limits);
  if (!query) {
    return err("not_found");
  }
  return canAccess(query, action) ? ok(query) : err("forbidden");
};
