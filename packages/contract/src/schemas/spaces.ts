import { z } from "zod";

import {
  conversationIdSchema,
  libraryItemIdSchema,
  microUsdSchema,
  nameSchema,
  orgIdSchema,
  providerKeyIdSchema,
  teamIdSchema,
  timestampSchema,
  userIdSchema,
} from "./common";
import { providerIdSchema } from "./models";
import { userSummarySchema } from "./tenancy";

// Spaces (ticket 187): the product's name for the org and team tree of D17.
// A root space is an org; a sub-space is a team (`team.parentId`). Content
// shared to a space (a `resource_grant` to it as principal) is visible to
// its members and the members of every space below it. Nothing flows up or
// sideways. The personal space is the caller's hidden personal org.

/** Which space: an org (a root space) or a team (a sub-space). The chat-context and grant-principal shape. */
export const spaceRefSchema = z.discriminatedUnion("type", [
  z.object({ id: orgIdSchema, type: z.literal("org") }),
  z.object({ id: teamIdSchema, type: z.literal("team") }),
]);
export type SpaceRef = z.infer<typeof spaceRefSchema>;

/** A space in a path: `/spaces/{type}/{id}`. */
export const spacePathSchema = z.object({
  id: z.union([orgIdSchema, teamIdSchema]),
  type: z.enum(["org", "team"]),
});

/**
 * Space roles. A root space uses the org's roles; a sub-space's `owner` is
 * stored as team `admin`, and it has no separate `admin`.
 */
export const spaceRoleSchema = z.enum(["owner", "admin", "member"]);
export type SpaceRole = z.infer<typeof spaceRoleSchema>;

/**
 * How the caller reaches a space: as a member of it, through a space above
 * it that they administer, or only as a member of the root (they can see the
 * space exists but not what's shared in it).
 */
export const spaceAccessSchema = z.enum(["member", "admin", "root_member"]);
export type SpaceAccess = z.infer<typeof spaceAccessSchema>;

export const spaceSchema = z.object({
  access: spaceAccessSchema,
  /** Whether the caller may manage members, sub-spaces, allowance and keys. */
  canManage: z.boolean(),
  id: z.union([orgIdSchema, teamIdSchema]),
  /** The hidden personal org; one per user. */
  isPersonal: z.boolean(),
  memberCount: z.int().min(0),
  /** The caller's own role here, when they're a direct member. */
  myRole: spaceRoleSchema.nullable(),
  name: nameSchema,
  /** The root space (org) this space belongs to. */
  orgId: orgIdSchema,
  /** `null` for a root space; the parent space otherwise. */
  parent: spaceRefSchema.nullable(),
  type: z.enum(["org", "team"]),
});
export type Space = z.infer<typeof spaceSchema>;

export const spaceContentTypeSchema = z.enum([
  "conversation",
  "agent",
  "skill",
]);
export type SpaceContentType = z.infer<typeof spaceContentTypeSchema>;

/** Something shared to a space, or to a space above it. */
export const spaceContentItemSchema = z.object({
  resourceId: z.union([conversationIdSchema, libraryItemIdSchema]),
  resourceType: spaceContentTypeSchema,
  sharedAt: timestampSchema,
  sharedBy: userSummarySchema,
  /** Where it was shared: this space, or the ancestor it flows down from. */
  sharedIn: spaceRefSchema,
  sharedInName: nameSchema,
  title: z.string(),
});
export type SpaceContentItem = z.infer<typeof spaceContentItemSchema>;

export const spaceMemberSchema = z.object({
  addedAt: timestampSchema,
  role: spaceRoleSchema,
  user: userSummarySchema,
});
export type SpaceMember = z.infer<typeof spaceMemberSchema>;

export const allowanceGrantStatusSchema = z.enum([
  "pending",
  "approved",
  "denied",
]);

/** A member's monthly draw on a space's token allowance, granted by an owner. */
export const allowanceGrantSchema = z.object({
  decidedAt: timestampSchema.nullable(),
  decidedBy: userIdSchema.nullable(),
  id: z.uuid(),
  monthlyTokens: z.int().min(1),
  note: z.string().max(500),
  requestedAt: timestampSchema,
  status: allowanceGrantStatusSchema,
  /** Tokens this member used in this space this month. */
  usedTokens: z.int().min(0),
  user: userSummarySchema,
});
export type AllowanceGrant = z.infer<typeof allowanceGrantSchema>;

export const spaceAllowanceSchema = z.object({
  grants: z.array(allowanceGrantSchema),
  /** `null` when the space has no allowance. */
  monthlyTokens: z.int().min(0).nullable(),
  /** The caller's tokens left this month: the smaller of their grant's and the pool's. */
  myRemainingTokens: z.int().min(0),
  resetsAt: timestampSchema,
  usedTokens: z.int().min(0),
});
export type SpaceAllowance = z.infer<typeof spaceAllowanceSchema>;

/** Usage against one of a space's keys this month. */
export const keyUsageRowSchema = z.object({
  costMicros: microUsdSchema,
  createdBy: userSummarySchema.nullable(),
  hint: z.string().max(8),
  /** `null` for usage recorded before keys were attributed. */
  keyId: providerKeyIdSchema.nullable(),
  label: z.string().max(100),
  lastUsedAt: timestampSchema.nullable(),
  provider: providerIdSchema.nullable(),
  tokens: z.int().min(0),
  transactions: z.int().min(0),
});
export type KeyUsageRow = z.infer<typeof keyUsageRowSchema>;

export const keyUsageSchema = z.object({
  from: timestampSchema,
  rows: z.array(keyUsageRowSchema),
  to: timestampSchema,
});
export type KeyUsage = z.infer<typeof keyUsageSchema>;
