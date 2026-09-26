import type {
  GrantId,
  ShareLinkId,
  UserId,
} from "@workspace/contract/schemas/common";
import {
  chatPermissionSchema,
  type GrantableResourceType,
  type ResourceRef,
} from "@workspace/contract/schemas/grants";
import { libraryPermissionSchema } from "@workspace/contract/schemas/library";
import type { Principal } from "@workspace/contract/schemas/tenancy";
import { type AsyncResult, err, ok } from "@workspace/shared/result";
import {
  and,
  asc,
  eq,
  gt,
  inArray,
  isNull,
  or,
  type SQL,
  type SQLWrapper,
  sql,
} from "drizzle-orm";

import type { Db } from "../client";
import {
  type ConflictError,
  conflict,
  type NotFoundError,
  notFound,
} from "../errors";
import {
  type GrantPermission,
  resourceGrant,
  shareLink,
} from "../schema/access";

// Grants (D13, D25): the only source of access beyond ownership. These are
// the reads and writes; deciding what a set of grants adds up to
// (`effectiveGrants`, levels, flow-down) is ticket 012's pure core, fed by
// `listGrantsForPrincipals` and `loadPrincipals`.

export type GrantRow = typeof resourceGrant.$inferSelect;
export type ShareLinkRow = typeof shareLink.$inferSelect;

/** Whether `permission` is a level `resourceType` takes (chats vs library items). */
export const isPermissionFor = (
  resourceType: GrantableResourceType,
  permission: string
): permission is GrantPermission =>
  resourceType === "conversation"
    ? (chatPermissionSchema.options as readonly string[]).includes(permission)
    : (libraryPermissionSchema.options as readonly string[]).includes(
        permission
      );

/** `resource_grant` rows held by any of `principals`, as one SQL condition. */
export const heldBy = (principals: readonly Principal[]): SQL =>
  principals.length === 0
    ? sql`false`
    : (or(
        ...principals.map((principal) =>
          and(
            eq(resourceGrant.principalType, principal.type),
            eq(resourceGrant.principalId, principal.id)
          )
        )
      ) ?? sql`false`);

export interface GrantInput {
  readonly grantedBy: UserId;
  readonly permission: GrantPermission;
  readonly principal: Principal;
  readonly resource: ResourceRef;
}

/** Share: grants `principal` access, replacing its level if it already had one. */
export const upsertGrant = async (
  db: Db,
  input: GrantInput
): AsyncResult<GrantRow, ConflictError> => {
  if (!isPermissionFor(input.resource.resourceType, input.permission)) {
    return err(conflict("invalid_permission", input.permission));
  }
  const [row] = await db
    .insert(resourceGrant)
    .values({
      grantedBy: input.grantedBy,
      permission: input.permission,
      principalId: input.principal.id,
      principalType: input.principal.type,
      resourceId: input.resource.resourceId,
      resourceType: input.resource.resourceType,
    })
    .onConflictDoUpdate({
      set: {
        grantedBy: input.grantedBy,
        permission: input.permission,
        updatedAt: new Date(),
      },
      target: [
        resourceGrant.resourceType,
        resourceGrant.resourceId,
        resourceGrant.principalType,
        resourceGrant.principalId,
      ],
    })
    .returning();
  if (!row) {
    throw new Error("upsert returned no row");
  }
  return ok(row);
};

export const getGrant = async (
  db: Db,
  id: GrantId
): AsyncResult<GrantRow, NotFoundError> => {
  const [row] = await db
    .select()
    .from(resourceGrant)
    .where(eq(resourceGrant.id, id));
  return row ? ok(row) : err(notFound("grant", id));
};

export const updateGrantPermission = async (
  db: Db,
  id: GrantId,
  permission: string
): AsyncResult<GrantRow, NotFoundError | ConflictError> => {
  const found = await getGrant(db, id);
  if (!found.ok) {
    return found;
  }
  if (!isPermissionFor(found.value.resourceType, permission)) {
    return err(conflict("invalid_permission", permission));
  }
  const [row] = await db
    .update(resourceGrant)
    .set({ permission })
    .where(eq(resourceGrant.id, id))
    .returning();
  return row ? ok(row) : err(notFound("grant", id));
};

export const deleteGrant = async (
  db: Db,
  id: GrantId
): AsyncResult<GrantRow, NotFoundError> => {
  const [row] = await db
    .delete(resourceGrant)
    .where(eq(resourceGrant.id, id))
    .returning();
  return row ? ok(row) : err(notFound("grant", id));
};

/** Who has access to a resource, oldest grant first. */
export const listGrantsForResource = (
  db: Db,
  resource: ResourceRef
): Promise<GrantRow[]> =>
  db
    .select()
    .from(resourceGrant)
    .where(
      and(
        eq(resourceGrant.resourceType, resource.resourceType),
        eq(resourceGrant.resourceId, resource.resourceId)
      )
    )
    .orderBy(asc(resourceGrant.createdAt), asc(resourceGrant.id));

export interface GrantFilter {
  readonly resourceIds?: readonly string[];
  readonly resourceType?: GrantableResourceType;
}

/** Every grant held by any of `principals` (from `loadPrincipals`), optionally narrowed. */
export const listGrantsForPrincipals = (
  db: Db,
  principals: readonly Principal[],
  filter: GrantFilter = {}
): Promise<GrantRow[]> =>
  db
    .select()
    .from(resourceGrant)
    .where(
      and(
        heldBy(principals),
        filter.resourceType === undefined
          ? undefined
          : eq(resourceGrant.resourceType, filter.resourceType),
        filter.resourceIds === undefined
          ? undefined
          : inArray(resourceGrant.resourceId, [...filter.resourceIds])
      )
    )
    .orderBy(asc(resourceGrant.createdAt), asc(resourceGrant.id));

/**
 * Removes a resource's grants and share links. Call it in the transaction
 * that deletes the resource: grants are polymorphic, so no foreign key does it.
 */
export const deleteGrantsForResource = async (
  db: Db,
  resource: ResourceRef
): Promise<void> => {
  await db
    .delete(resourceGrant)
    .where(
      and(
        eq(resourceGrant.resourceType, resource.resourceType),
        eq(resourceGrant.resourceId, resource.resourceId)
      )
    );
  await db
    .delete(shareLink)
    .where(
      and(
        eq(shareLink.resourceType, resource.resourceType),
        eq(shareLink.resourceId, resource.resourceId)
      )
    );
};

// --- Share links ---

export interface ShareLinkInput {
  readonly createdBy: UserId;
  readonly expiresAt?: Date | null;
  readonly resource: ResourceRef;
  /** Minted by the caller (22+ random URL-safe characters); stored as given. */
  readonly token: string;
}

export const createShareLink = async (
  db: Db,
  input: ShareLinkInput
): Promise<ShareLinkRow> => {
  const [row] = await db
    .insert(shareLink)
    .values({
      createdBy: input.createdBy,
      expiresAt: input.expiresAt ?? null,
      resourceId: input.resource.resourceId,
      resourceType: input.resource.resourceType,
      token: input.token,
    })
    .returning();
  if (!row) {
    throw new Error("insert returned no row");
  }
  return row;
};

/** Live links only: not revoked, not expired. */
const isLive = (now: Date): SQL | undefined =>
  and(
    isNull(shareLink.revokedAt),
    or(isNull(shareLink.expiresAt), gt(shareLink.expiresAt, now))
  );

/** The live link for `token`; revoked and expired links are `not_found`. */
export const findShareLinkByToken = async (
  db: Db,
  token: string,
  now: Date = new Date()
): AsyncResult<ShareLinkRow, NotFoundError> => {
  const [row] = await db
    .select()
    .from(shareLink)
    .where(and(eq(shareLink.token, token), isLive(now)));
  // The token is a credential: never put it in an error.
  return row ? ok(row) : err(notFound("share_link", "token"));
};

export const listShareLinks = (
  db: Db,
  resource: ResourceRef
): Promise<ShareLinkRow[]> =>
  db
    .select()
    .from(shareLink)
    .where(
      and(
        eq(shareLink.resourceType, resource.resourceType),
        eq(shareLink.resourceId, resource.resourceId)
      )
    )
    .orderBy(asc(shareLink.createdAt));

export const revokeShareLink = async (
  db: Db,
  id: ShareLinkId,
  now: Date = new Date()
): AsyncResult<ShareLinkRow, NotFoundError> => {
  const [row] = await db
    .update(shareLink)
    .set({
      revokedAt: sql`coalesce(${shareLink.revokedAt}, ${now.toISOString()}::timestamptz)`,
    })
    .where(eq(shareLink.id, id))
    .returning();
  return row ? ok(row) : err(notFound("share_link", id));
};

/** SQL: a live share link exists for the resource in `resourceId` (for visibility). */
export const hasLiveShareLink = (
  resourceType: GrantableResourceType,
  resourceId: SQLWrapper,
  now: Date = new Date()
): SQL =>
  sql`exists (select 1 from ${shareLink} where ${shareLink.resourceType} = ${resourceType} and ${shareLink.resourceId} = ${resourceId} and ${isLive(now)})`;
