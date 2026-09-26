import { randomBytes } from "node:crypto";

import type {
  OrgId,
  ShareLinkId,
  TeamId,
  UserId,
} from "@workspace/contract/schemas/common";
import type { ResourceRef } from "@workspace/contract/schemas/grants";
import type { Principal } from "@workspace/contract/schemas/tenancy";
import type { Db } from "@workspace/db/client";
import {
  createShareLink,
  deleteGrant,
  findShareLinkByToken,
  getGrant,
  listGrantsForResource,
  listShareLinks,
  revokeShareLink,
  updateGrantPermission,
  upsertGrant,
} from "@workspace/db/queries/grants";
import { shareLink } from "@workspace/db/schema/access";
import { user } from "@workspace/db/schema/auth";
import { team } from "@workspace/db/schema/tenancy";
import { eq } from "drizzle-orm";

import type { AccessAction } from "../access";
import { checkAccess, orgRoleOf } from "../resources";
import { authed, os } from "./base";
import type { HandlerContext } from "./context";
import { nowOf } from "./context";
import { toResourceGrant, toShareLink } from "./views";

// Sharing (D13, D25): grants and public links. Only the owner (and a
// published item's maintainers) share, change levels or make links; anyone
// with access can see who else has it. A missing resource and one the
// caller can't see are the same `NOT_FOUND`.

/** Whether the resource exists, and whether the caller may do `action` to it. */
const allowed = async (
  context: HandlerContext & { readonly userId: UserId },
  ref: ResourceRef,
  action: AccessAction
): Promise<{ readonly exists: boolean; readonly ok: boolean }> => {
  const checked = await checkAccess(
    context.db,
    context.userId,
    ref,
    action,
    context.config.policies
  );
  return {
    exists: checked.ok || checked.error === "forbidden",
    ok: checked.ok,
  };
};

/** Seeing a resource at all: the lowest level its type takes. */
const lowestLevel = (ref: ResourceRef): AccessAction =>
  ref.resourceType === "conversation" ? "viewer" : "use";

/**
 * A principal someone may share with: any existing user, or a team or org
 * the sharer belongs to (sharing into an org you're not in would be a way
 * to reach its members uninvited).
 */
const principalCheck = async (
  db: Db,
  sharer: UserId,
  principal: Principal
): Promise<boolean> => {
  switch (principal.type) {
    case "user": {
      const [row] = await db
        .select({ id: user.id })
        .from(user)
        .where(eq(user.id, principal.id));
      return row !== undefined;
    }
    case "org":
      return (await orgRoleOf(db, principal.id, sharer)) !== null;
    case "team": {
      const [row] = await db
        .select({ orgId: team.orgId })
        .from(team)
        .where(eq(team.id, principal.id as TeamId));
      return (
        row !== undefined &&
        (await orgRoleOf(db, row.orgId as OrgId, sharer)) !== null
      );
    }
    default:
      return principal satisfies never;
  }
};

/** 32 random bytes, URL-safe: the link's only credential. */
const mintToken = (): string => randomBytes(32).toString("base64url");

export const grants = {
  create: authed.grants.create.handler(async ({ context, errors, input }) => {
    const ref = {
      resourceId: input.resourceId,
      resourceType: input.resourceType,
    };
    const access = await allowed(context, ref, "manage");
    if (!access.exists) {
      throw errors.NOT_FOUND();
    }
    if (!access.ok) {
      throw errors.FORBIDDEN();
    }
    if (!(await principalCheck(context.db, context.userId, input.principal))) {
      throw errors.VALIDATION({
        data: {
          issues: [
            {
              message: "no such user, or a team or org you're not in",
              path: ["principal"],
            },
          ],
        },
      });
    }
    const granted = await upsertGrant(context.db, {
      grantedBy: context.userId,
      permission: input.permission,
      principal: input.principal,
      resource: ref,
    });
    if (!granted.ok) {
      throw errors.VALIDATION({
        data: {
          issues: [
            {
              message: "that level doesn't fit this resource",
              path: ["permission"],
            },
          ],
        },
      });
    }
    return toResourceGrant(granted.value);
  }),

  list: authed.grants.list.handler(async ({ context, errors, input }) => {
    const access = await allowed(context, input, lowestLevel(input));
    if (!access.ok) {
      throw errors.NOT_FOUND();
    }
    const rows = await listGrantsForResource(context.db, input);
    return rows.map(toResourceGrant);
  }),

  revoke: authed.grants.revoke.handler(async ({ context, errors, input }) => {
    const found = await getGrant(context.db, input.id);
    if (!found.ok) {
      throw errors.NOT_FOUND();
    }
    const row = found.value;
    const ref = {
      resourceId: row.resourceId,
      resourceType: row.resourceType,
    } as ResourceRef;
    // A user may always drop a share made to them personally.
    const ownGrant =
      row.principalType === "user" && row.principalId === context.userId;
    if (!ownGrant) {
      const access = await allowed(context, ref, "manage");
      if (!access.ok) {
        throw access.exists ? errors.FORBIDDEN() : errors.NOT_FOUND();
      }
    }
    await deleteGrant(context.db, input.id);
  }),

  update: authed.grants.update.handler(async ({ context, errors, input }) => {
    const found = await getGrant(context.db, input.id);
    if (!found.ok) {
      throw errors.NOT_FOUND();
    }
    const ref = {
      resourceId: found.value.resourceId,
      resourceType: found.value.resourceType,
    } as ResourceRef;
    const access = await allowed(context, ref, "manage");
    if (!access.ok) {
      throw access.exists ? errors.FORBIDDEN() : errors.NOT_FOUND();
    }
    const updated = await updateGrantPermission(
      context.db,
      input.id,
      input.permission
    );
    if (!updated.ok) {
      if (updated.error.type === "not_found") {
        throw errors.NOT_FOUND();
      }
      throw errors.VALIDATION({
        data: {
          issues: [
            {
              message: "that level doesn't fit this resource",
              path: ["permission"],
            },
          ],
        },
      });
    }
    return toResourceGrant(updated.value);
  }),
};

export const shareLinks = {
  create: authed.shareLinks.create.handler(
    async ({ context, errors, input }) => {
      if (!context.config.features.publicLinks) {
        throw errors.FEATURE_DISABLED({ data: { feature: "publicLinks" } });
      }
      const ref = {
        resourceId: input.resourceId,
        resourceType: input.resourceType,
      };
      const access = await allowed(context, ref, "manage");
      if (!access.ok) {
        throw access.exists ? errors.FORBIDDEN() : errors.NOT_FOUND();
      }
      const row = await createShareLink(context.db, {
        createdBy: context.userId,
        expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
        resource: ref,
        token: mintToken(),
      });
      return toShareLink(row, context.appUrl);
    }
  ),

  list: authed.shareLinks.list.handler(async ({ context, errors, input }) => {
    const access = await allowed(context, input, "manage");
    if (!access.ok) {
      throw access.exists ? errors.FORBIDDEN() : errors.NOT_FOUND();
    }
    const rows = await listShareLinks(context.db, input);
    return rows.map((row) => toShareLink(row, context.appUrl));
  }),

  resolve: os.shareLinks.resolve.handler(async ({ context, errors, input }) => {
    if (!context.config.features.publicLinks) {
      throw errors.FEATURE_DISABLED({ data: { feature: "publicLinks" } });
    }
    const found = await findShareLinkByToken(
      context.db,
      input.token,
      nowOf(context)
    );
    if (!found.ok) {
      throw errors.NOT_FOUND();
    }
    const shared = await context.loadSharedResource?.({
      resourceId: found.value.resourceId,
      resourceType: found.value.resourceType,
    } as ResourceRef);
    if (!shared) {
      throw errors.NOT_FOUND();
    }
    return shared;
  }),

  revoke: authed.shareLinks.revoke.handler(
    async ({ context, errors, input }) => {
      const [row] = await context.db
        .select()
        .from(shareLink)
        .where(eq(shareLink.id, input.id as ShareLinkId));
      if (!row) {
        throw errors.NOT_FOUND();
      }
      const ref = {
        resourceId: row.resourceId,
        resourceType: row.resourceType,
      } as ResourceRef;
      const access = await allowed(context, ref, "manage");
      if (!access.ok) {
        throw access.exists ? errors.FORBIDDEN() : errors.NOT_FOUND();
      }
      await revokeShareLink(context.db, input.id, nowOf(context));
    }
  ),
};
