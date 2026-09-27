import { implement, ORPCError } from "@orpc/server";
import { contract } from "@workspace/contract/contract";
import {
  baseErrors,
  conflictError,
  featureError,
} from "@workspace/contract/errors";
import type { LibraryItemId, UserId } from "@workspace/contract/schemas/common";
import type {
  ResourceRef,
  SharedResource,
} from "@workspace/contract/schemas/grants";
import type { LibraryKind } from "@workspace/contract/schemas/library";
import type { Db } from "@workspace/db/client";
import { findLibraryItem } from "@workspace/db/queries/library-items";
import type { Result } from "@workspace/shared/result";

import type { RequestContext } from "../context";
import { currentDefinition, type LibraryDeps, resolveItem } from "./core";
import type { LibraryError } from "./errors";
import {
  createItem,
  deleteItem,
  getItem,
  listItems,
  updateItem,
} from "./items";
import {
  duplicateItem,
  exportItem,
  getVersionOf,
  importItem,
  listVersions,
  publishToLibrary,
  publishVersion,
  restoreVersion,
  setItemMaintainers,
  toExport,
} from "./publishing";

// The contract's `library` group (D13, ticket 017) as a router 025 mounts
// beside the chat routes: `createApp({ routers: createLibraryRouter(deps) })`.
// It runs on the server's own `RequestContext`, so it needs nothing from the
// auth package at request time beyond the session the shell resolved.
// Sharing and public links are the `grants` and `shareLinks` groups
// (`@workspace/auth/handlers`); `loadSharedLibraryItem` below is what those
// links show for a library item.

/** The contract's typed error for a library refusal. Status and message come from the contract. */
const toOrpcError = (error: LibraryError): ORPCError<string, unknown> => {
  switch (error.type) {
    case "not_found":
      return new ORPCError("NOT_FOUND", baseErrors.NOT_FOUND);
    case "forbidden":
      return new ORPCError("FORBIDDEN", baseErrors.FORBIDDEN);
    case "validation":
      return new ORPCError("VALIDATION", {
        data: { issues: error.issues },
        message: baseErrors.VALIDATION.message,
        status: baseErrors.VALIDATION.status,
      });
    case "conflict":
      return new ORPCError("CONFLICT", {
        data: { reason: error.reason },
        message: conflictError.CONFLICT.message,
        status: conflictError.CONFLICT.status,
      });
    case "feature_disabled":
      return new ORPCError("FEATURE_DISABLED", {
        data: { feature: error.feature },
        message: featureError.FEATURE_DISABLED.message,
        status: featureError.FEATURE_DISABLED.status,
      });
    default:
      return error satisfies never;
  }
};

/** A value, or the typed error thrown once here at the shell. */
const unwrap = <T>(result: Result<T, LibraryError>): T => {
  if (!result.ok) {
    throw toOrpcError(result.error);
  }
  return result.value;
};

export const createLibraryRouter = (deps: LibraryDeps) => {
  const os = implement({
    library: contract.library,
  }).$context<RequestContext>();
  const authed = os.use(({ context, next }) => {
    if (!context.session) {
      throw new ORPCError("UNAUTHORIZED", baseErrors.UNAUTHORIZED);
    }
    return next({ context: { userId: context.session.userId as UserId } });
  });
  const { library } = authed;

  return os.router({
    library: {
      create: library.create.handler(async ({ context, input }) =>
        unwrap(await createItem(deps, context.userId, input))
      ),
      delete: library.delete.handler(async ({ context, input }) => {
        unwrap(await deleteItem(deps, context.userId, input));
      }),
      duplicate: library.duplicate.handler(async ({ context, input }) =>
        unwrap(await duplicateItem(deps, context.userId, input))
      ),
      export: library.export.handler(async ({ context, input }) =>
        unwrap(await exportItem(deps, context.userId, input))
      ),
      get: library.get.handler(async ({ context, input }) =>
        unwrap(await getItem(deps, context.userId, input))
      ),
      getVersion: library.getVersion.handler(async ({ context, input }) =>
        unwrap(await getVersionOf(deps, context.userId, input))
      ),
      import: library.import.handler(async ({ context, input }) =>
        unwrap(await importItem(deps, context.userId, input))
      ),
      list: library.list.handler(async ({ context, input }) => {
        const page = unwrap(await listItems(deps, context.userId, input));
        return { items: [...page.items], nextCursor: page.nextCursor };
      }),
      listVersions: library.listVersions.handler(async ({ context, input }) => {
        const page = unwrap(await listVersions(deps, context.userId, input));
        return { items: [...page.items], nextCursor: page.nextCursor };
      }),
      publishToLibrary: library.publishToLibrary.handler(
        async ({ context, input }) =>
          unwrap(await publishToLibrary(deps, context.userId, input))
      ),
      publishVersion: library.publishVersion.handler(
        async ({ context, input }) =>
          unwrap(await publishVersion(deps, context.userId, input))
      ),
      restoreVersion: library.restoreVersion.handler(
        async ({ context, input }) =>
          unwrap(await restoreVersion(deps, context.userId, input))
      ),
      setMaintainers: library.setMaintainers.handler(
        async ({ context, input }) =>
          unwrap(await setItemMaintainers(deps, context.userId, input))
      ),
      update: library.update.handler(async ({ context, input }) =>
        unwrap(await updateItem(deps, context.userId, input))
      ),
    },
  });
};

export type LibraryRouter = ReturnType<typeof createLibraryRouter>;

/**
 * What a public link to a library item shows (`shareLinks.resolve`): the
 * portable export of its latest published version, or the draft before the
 * first publish. Pass it as the auth handlers' `loadSharedResource` (for
 * library resource types; chats are 014's).
 */
export const loadSharedLibraryItem =
  (db: Db, now: () => Date = () => new Date()) =>
  async (ref: ResourceRef): Promise<SharedResource | null> => {
    if (ref.resourceType === "conversation") {
      return null;
    }
    const found = await findLibraryItem(db, ref.resourceId as LibraryItemId);
    if (!found || found.kind !== ref.resourceType) {
      return null;
    }
    const current = await currentDefinition(db, found, true);
    if (!current) {
      return null;
    }
    return {
      item: toExport(found.row, current.definition, now()),
      resourceType: found.kind,
    } as SharedResource;
  };

/**
 * Whether `userId` may run an item (any level includes `use`), for the
 * run-creation check the runs workstream makes before starting an agent.
 */
export const canUseLibraryItem = async (
  db: Db,
  userId: UserId,
  kind: LibraryKind,
  id: LibraryItemId
): Promise<boolean> => {
  const resolved = await resolveItem(db, userId, id);
  return resolved.ok && resolved.value.kind === kind;
};
