import {
  type ResourceGrant,
  resourceGrantSchema,
  type ShareLink,
} from "@workspace/contract/schemas/grants";
import {
  type Invitation,
  invitationStatusSchema,
  type Org,
  type OrgRole,
  orgRoleSchema,
  type Team,
  type UserSummary,
} from "@workspace/contract/schemas/tenancy";
import type { GrantRow, ShareLinkRow } from "@workspace/db/queries/grants";
import type { invitation, organization, user } from "@workspace/db/schema/auth";
import type { team } from "@workspace/db/schema/tenancy";
import { z } from "zod";

// Database rows to the contract's wire shapes: ISO timestamps, `null` over
// `undefined`, and only what the caller may see.

const iso = (date: Date): string => date.toISOString();

/** A stored logo that isn't a URL (Better Auth accepts any string) shows as none. */
export const urlOrNull = (value: string | null | undefined): string | null =>
  value && z.url().safeParse(value).success ? value : null;

export const toOrg = (
  row: typeof organization.$inferSelect,
  myRole: OrgRole
): Org => ({
  createdAt: iso(row.createdAt),
  id: row.id,
  isPersonal: row.isPersonal,
  logoUrl: urlOrNull(row.logo),
  myRole,
  name: row.name,
  slug: row.slug,
});

export const toTeam = (row: typeof team.$inferSelect): Team => ({
  createdAt: iso(row.createdAt),
  id: row.id,
  name: row.name,
  orgId: row.orgId,
  parentId: row.parentId,
});

/** Emails are shown only to people who share an org with the user (callers check). */
export const toUserSummary = (
  row: Pick<typeof user.$inferSelect, "email" | "id" | "image" | "name">
): UserSummary => ({
  email: row.email,
  id: row.id,
  image: urlOrNull(row.image),
  name: row.name,
});

export const toInvitation = (
  row: typeof invitation.$inferSelect,
  teamIds: Invitation["teamIds"],
  now: Date
): Invitation => {
  const stored = invitationStatusSchema.catch("pending").parse(row.status);
  return {
    createdAt: iso(row.createdAt),
    email: row.email,
    expiresAt: iso(row.expiresAt),
    id: row.id,
    invitedBy: row.inviterId,
    orgId: row.organizationId,
    role: orgRoleSchema.catch("member").parse(row.role ?? "member"),
    // Better Auth leaves an expired invitation `pending`; say what it is.
    status: stored === "pending" && row.expiresAt <= now ? "expired" : stored,
    teamIds,
  };
};

export const toResourceGrant = (row: GrantRow): ResourceGrant =>
  // The row's permission is checked against its type by a CHECK constraint;
  // parsing narrows the union for TypeScript.
  resourceGrantSchema.parse({
    createdAt: iso(row.createdAt),
    grantedBy: row.grantedBy,
    id: row.id,
    permission: row.permission,
    principal: { id: row.principalId, type: row.principalType },
    resourceId: row.resourceId,
    resourceType: row.resourceType,
  });

export const shareUrl = (appUrl: string, token: string): string =>
  new URL(`/share/${token}`, appUrl).toString();

export const toShareLink = (row: ShareLinkRow, appUrl: string): ShareLink => ({
  createdAt: iso(row.createdAt),
  createdBy: row.createdBy,
  expiresAt: row.expiresAt ? iso(row.expiresAt) : null,
  id: row.id,
  resourceId: row.resourceId as ShareLink["resourceId"],
  resourceType: row.resourceType,
  revokedAt: row.revokedAt ? iso(row.revokedAt) : null,
  token: row.token,
  url: shareUrl(appUrl, row.token),
});
