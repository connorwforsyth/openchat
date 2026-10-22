import { effectiveGrants } from "@workspace/auth/access";
import type {
  LibraryVersionId,
  UserId,
} from "@workspace/contract/schemas/common";
import type {
  createLibraryItemInputSchema,
  getLibraryItemInputSchema,
  LibraryItem,
  LibraryItemDetail,
  listLibraryInputSchema,
  updateLibraryItemInputSchema,
} from "@workspace/contract/schemas/library";
import type { Principal } from "@workspace/contract/schemas/tenancy";
import type { Db } from "@workspace/db/client";
import { deleteVersionedItem } from "@workspace/db/queries/library";
import {
  deleteUnversionedItem,
  type FoundLibraryItem,
  listLibraryItems,
} from "@workspace/db/queries/library-items";
import {
  decodeCursor,
  encodeCursor,
  type Page,
} from "@workspace/db/queries/page";
import { type AsyncResult, err, ok } from "@workspace/shared/result";
import type { z } from "zod";

import { allows, libraryAccessOf } from "./access";
import {
  currentDefinition,
  detailOf,
  freshDetail,
  isVersionedKind,
  itemViews,
  type LibraryDeps,
  loadCaller,
  type Resolved,
  resolveItem,
  unversionedDefinition,
  versionDefinition,
} from "./core";
import { prepareDefinition } from "./definitions";
import { forbidden, invalid, type LibraryError } from "./errors";
import { storeNewItem, storeUpdate } from "./store";

// Listing, reading and editing library items (D13). Every function takes
// the caller's id and returns a `Result`; the router maps errors to the
// contract's.

type ListInput = z.infer<typeof listLibraryInputSchema>;
type GetInput = z.infer<typeof getLibraryItemInputSchema>;
type CreateInput = z.infer<typeof createLibraryItemInputSchema>;
type UpdateInput = z.infer<typeof updateLibraryItemInputSchema>;

const sameOwner = (a: Principal, b: { ownerId: string; ownerType: string }) =>
  a.type === b.ownerType && a.id === b.ownerId;

/**
 * One tab of the library (D13). My library: what the caller owns. Shared
 * with me: items shared with them, a team or an org they're in (grants
 * flow down the team tree), that they don't own and whose library they
 * aren't in. Spaces: the libraries of every team (and ancestor team)
 * and org they belong to.
 */
export const listItems = async (
  deps: LibraryDeps,
  userId: UserId,
  input: ListInput
): AsyncResult<Page<LibraryItem>, LibraryError> => {
  const { db } = deps;
  let after: { id: string; key: string | number } | undefined;
  if (input.cursor) {
    const decoded = decodeCursor(input.cursor);
    if (!decoded.ok) {
      return err(invalid("Unknown cursor.", ["cursor"]));
    }
    after = decoded.value;
  }
  const caller = await loadCaller(db, userId);
  const common = {
    after,
    kind: input.kind,
    limit: input.limit,
    query: input.query || undefined,
  };

  let rows: FoundLibraryItem[];
  switch (input.tab) {
    case "mine":
      rows = await listLibraryItems(db, {
        ...common,
        owners: [{ id: userId, type: "user" }],
      });
      break;
    case "libraries": {
      const libraries = caller.principals.filter(
        (principal) =>
          principal.type !== "user" &&
          (input.ownerId === undefined ||
            (principal.id === input.ownerId &&
              (input.ownerType === undefined ||
                principal.type === input.ownerType)))
      );
      rows = await listLibraryItems(db, { ...common, owners: libraries });
      break;
    }
    case "shared": {
      const ids = effectiveGrants(caller.principals, caller.grants, []).map(
        (grant) => grant.resourceId
      );
      // Filtered after fetching (ownership decides), so fetch them all and page here.
      const all = await listLibraryItems(db, {
        ...common,
        ids,
        limit: Math.max(ids.length, 1),
      });
      rows = all
        .filter(
          (item) =>
            !(
              sameOwner({ id: userId, type: "user" }, item.row) ||
              caller.principals.some((principal) =>
                sameOwner(principal, item.row)
              )
            )
        )
        .slice(0, input.limit + 1);
      break;
    }
    default:
      return input.tab satisfies never;
  }

  const visible = rows.flatMap((item) => {
    const access = libraryAccessOf(caller, item.kind, item.row);
    return access ? [{ ...item, access }] : [];
  });
  const page = visible.slice(0, input.limit);
  const last = page.at(-1);
  return ok({
    items: await itemViews(db, page),
    nextCursor:
      rows.length > input.limit && last
        ? encodeCursor({
            id: last.row.id,
            key: last.row.updatedAt.toISOString(),
          })
        : null,
  });
};

/**
 * One item. `use` sees the item but not its content (`definition: null`):
 * no instructions, no knowledge files (D13). `view` sees the latest
 * published version; the draft takes `edit`.
 */
export const getItem = async (
  deps: LibraryDeps,
  userId: UserId,
  input: GetInput
): AsyncResult<LibraryItemDetail, LibraryError> => {
  const { db } = deps;
  const resolved = await resolveItem(db, userId, input.id);
  if (!resolved.ok) {
    return resolved;
  }
  const item = resolved.value;
  const canView = allows(item.access, "view");
  const canEdit = allows(item.access, "edit");
  const { revision } = input;

  if (!isVersionedKind(item.kind)) {
    const definition = canView
      ? await unversionedDefinition(db, item.kind, item.row.id)
      : undefined;
    return ok(
      await detailOf(db, item, {
        definition: definition ?? null,
        versionId: null,
      })
    );
  }
  if (revision === "draft" && !canEdit) {
    return err(forbidden());
  }
  if (revision === "draft" || revision === "latest") {
    return await freshDetail(
      db,
      userId,
      item.row.id,
      revision as "draft" | "latest"
    );
  }
  // A specific version: the draft's id takes `edit` like `draft` does.
  if (revision === item.row.draftVersionId && !canEdit) {
    return err(forbidden());
  }
  const loaded = await versionDefinition(
    db,
    item.kind,
    item.row.id,
    revision as LibraryVersionId
  );
  if (!loaded) {
    return err({ type: "not_found" });
  }
  if (loaded.row.status === "draft" && !canEdit) {
    return err(forbidden());
  }
  return ok(
    await detailOf(db, item, {
      definition: canView ? loaded.definition : null,
      versionId: loaded.row.id as LibraryVersionId,
    })
  );
};

/** Creates a personal item; versioned kinds start as a draft with nothing published. */
export const createItem = async (
  deps: LibraryDeps,
  userId: UserId,
  input: CreateInput
): AsyncResult<LibraryItemDetail, LibraryError> => {
  const caller = await loadCaller(deps.db, userId, []);
  const prepared = await prepareDefinition(deps, caller, input.definition);
  if (!prepared.ok) {
    return prepared;
  }
  const id = await storeNewItem(deps.db, {
    createdBy: userId,
    meta: {
      description: input.description,
      icon: input.icon,
      name: input.name,
    },
    owner: { id: userId, type: "user" },
    prepared: prepared.value,
  });
  return await freshDetail(deps.db, userId, id, "draft");
};

/** What an edit replaces: the draft, or an unversioned item's definition. */
const editableDefinition = async (db: Db, item: Resolved) => {
  if (!isVersionedKind(item.kind)) {
    return await currentDefinition(db, item, true);
  }
  const draftId = item.row.draftVersionId;
  return draftId
    ? await versionDefinition(db, item.kind, item.row.id, draftId)
    : undefined;
};

/** Edits the draft (versioned kinds) or the item itself. Needs `edit`. */
export const updateItem = async (
  deps: LibraryDeps,
  userId: UserId,
  input: UpdateInput
): AsyncResult<LibraryItemDetail, LibraryError> => {
  const { db } = deps;
  const resolved = await resolveItem(db, userId, input.id, "edit");
  if (!resolved.ok) {
    return resolved;
  }
  const item = resolved.value;
  let prepared: Awaited<ReturnType<typeof prepareDefinition>> | undefined;
  if (input.definition) {
    if (input.definition.kind !== item.kind) {
      return err(
        invalid("The definition is for a different kind of item.", [
          "definition",
          "kind",
        ])
      );
    }
    const before = await editableDefinition(db, item);
    const hasSecret =
      before?.definition.kind === "mcp_server" &&
      before.definition.auth.type === "header" &&
      before.definition.auth.configured;
    prepared = await prepareDefinition(deps, item.caller, input.definition, {
      definition: before?.definition ?? null,
      hasSecret,
    });
    if (!prepared.ok) {
      return prepared;
    }
  }
  await storeUpdate(
    db,
    item.kind,
    item.row.id,
    {
      description: input.description,
      icon: input.icon,
      name: input.name,
    },
    prepared?.ok ? prepared.value : undefined
  );
  return await freshDetail(db, userId, item.row.id, "draft");
};

/** Deletes an item with its versions, grants and links. The owner's or a maintainer's call. */
export const deleteItem = async (
  deps: LibraryDeps,
  userId: UserId,
  input: { readonly id: LibraryItemDetail["id"] }
): AsyncResult<void, LibraryError> => {
  const resolved = await resolveItem(deps.db, userId, input.id, "manage");
  if (!resolved.ok) {
    return resolved;
  }
  const { kind, row } = resolved.value;
  const deleted = isVersionedKind(kind)
    ? await deleteVersionedItem(deps.db, kind, row.id)
    : await deleteUnversionedItem(deps.db, kind, row.id);
  return deleted.ok ? ok(undefined) : err({ type: "not_found" });
};
