import { z } from "zod";

import {
  conversationIdSchema,
  grantIdSchema,
  libraryItemIdSchema,
  shareLinkIdSchema,
  timestampSchema,
  userIdSchema,
} from "./common";
import { libraryExportSchema, libraryPermissionSchema } from "./library";
import { branchPathSchema } from "./messages";
import { principalSchema } from "./tenancy";

// Access (D13, D25): `resource_grant` is the only source of access to a
// conversation or library item beyond ownership. The permission enum depends
// on the resource type, so a grant is a union keyed by `resourceType`: chats
// take `viewer | editor`, library items take `use | view | edit`. A grant to
// a team also covers its descendant teams.

export const chatPermissionSchema = z.enum(["viewer", "editor"]);
export type ChatPermission = z.infer<typeof chatPermissionSchema>;

export const grantableResourceTypeSchema = z.enum([
  "conversation",
  "agent",
  "prompt",
  "skill",
  "mcp_server",
  "preset",
]);
export type GrantableResourceType = z.infer<typeof grantableResourceTypeSchema>;

const conversationGrantFields = z.object({
  permission: chatPermissionSchema,
  resourceId: conversationIdSchema,
  resourceType: z.literal("conversation"),
});

const libraryGrantFields = <
  K extends Exclude<GrantableResourceType, "conversation">,
>(
  kind: K
) =>
  z.object({
    permission: libraryPermissionSchema,
    resourceId: libraryItemIdSchema,
    resourceType: z.literal(kind),
  });

const grantFieldVariants = [
  conversationGrantFields,
  libraryGrantFields("agent"),
  libraryGrantFields("prompt"),
  libraryGrantFields("skill"),
  libraryGrantFields("mcp_server"),
  libraryGrantFields("preset"),
] as const;

/** What a grant covers and at which level, without who or when. */
export const grantScopeSchema = z.discriminatedUnion(
  "resourceType",
  grantFieldVariants
);
export type GrantScope = z.infer<typeof grantScopeSchema>;

const grantMeta = {
  createdAt: timestampSchema,
  grantedBy: userIdSchema,
  id: grantIdSchema,
  principal: principalSchema,
};

export const resourceGrantSchema = z.discriminatedUnion("resourceType", [
  conversationGrantFields.extend(grantMeta),
  libraryGrantFields("agent").extend(grantMeta),
  libraryGrantFields("prompt").extend(grantMeta),
  libraryGrantFields("skill").extend(grantMeta),
  libraryGrantFields("mcp_server").extend(grantMeta),
  libraryGrantFields("preset").extend(grantMeta),
]);
export type ResourceGrant = z.infer<typeof resourceGrantSchema>;

/** Share: grant `principal` access. Re-granting the same principal replaces the level. */
export const createGrantInputSchema = z.discriminatedUnion("resourceType", [
  conversationGrantFields.extend({ principal: principalSchema }),
  libraryGrantFields("agent").extend({ principal: principalSchema }),
  libraryGrantFields("prompt").extend({ principal: principalSchema }),
  libraryGrantFields("skill").extend({ principal: principalSchema }),
  libraryGrantFields("mcp_server").extend({ principal: principalSchema }),
  libraryGrantFields("preset").extend({ principal: principalSchema }),
]);
export type CreateGrantInput = z.infer<typeof createGrantInputSchema>;

/** The level must suit the grant's resource type (`VALIDATION` otherwise). */
export const updateGrantInputSchema = z.object({
  id: grantIdSchema,
  permission: z.union([chatPermissionSchema, libraryPermissionSchema]),
});

/** A resource named by type and id, flat so it fits a query string. */
export const resourceRefSchema = z.object({
  resourceId: z.union([conversationIdSchema, libraryItemIdSchema]),
  resourceType: grantableResourceTypeSchema,
});
export type ResourceRef = z.infer<typeof resourceRefSchema>;

/** A public, read-only link (`share_link`), if the instance allows them. */
export const shareLinkSchema = resourceRefSchema.extend({
  createdAt: timestampSchema,
  createdBy: userIdSchema,
  expiresAt: timestampSchema.nullable(),
  id: shareLinkIdSchema,
  revokedAt: timestampSchema.nullable(),
  /** Unguessable; the only credential the link needs. */
  token: z.string().min(22).max(128),
  url: z.url(),
});
export type ShareLink = z.infer<typeof shareLinkSchema>;

export const createShareLinkInputSchema = resourceRefSchema.extend({
  expiresAt: timestampSchema.optional(),
});

/** What an anonymous visitor sees through a share link. */
export const sharedResourceSchema = z.discriminatedUnion("resourceType", [
  z.object({
    /** The branch that was active for the sharer when the link was made. */
    branch: branchPathSchema,
    resourceType: z.literal("conversation"),
    title: z.string().nullable(),
  }),
  ...(["agent", "prompt", "skill", "mcp_server", "preset"] as const).map(
    (kind) =>
      z.object({ item: libraryExportSchema, resourceType: z.literal(kind) })
  ),
]);
export type SharedResource = z.infer<typeof sharedResourceSchema>;
