import {
  type AccessQuery,
  accessLevel,
  type GrantFact,
} from "@workspace/auth/access";
import type { UserId } from "@workspace/contract/schemas/common";
import type {
  LibraryAccess,
  LibraryKind,
} from "@workspace/contract/schemas/library";
import type { Principal } from "@workspace/contract/schemas/tenancy";
import type { AnyLibraryItemRow } from "@workspace/db/queries/library-items";

// The caller's access to a library item (D13), as pure functions over the
// facts the shell loaded once: who they act as (`loadPrincipals`, already
// expanded up the team tree, so grants to Eng reach Eng › Platform) and the
// library grants those principals hold. Levels come from `@workspace/auth`'s
// `accessLevel`; this adds the owner/maintainer distinction the contract's
// `myAccess` shows.

export interface Caller {
  /** The caller's library grants (any item; others are ignored). */
  readonly grants: readonly GrantFact[];
  readonly principals: readonly Principal[];
  readonly userId: UserId;
}

const RANK: Record<LibraryAccess, number> = {
  edit: 2,
  maintainer: 3,
  owner: 3,
  use: 0,
  view: 1,
};

/** Whether `access` includes `needed` (`manage` is the owner's or a maintainer's). */
export const allows = (
  access: LibraryAccess | null,
  needed: "use" | "view" | "edit" | "manage"
): boolean => {
  if (access === null) {
    return false;
  }
  return needed === "manage"
    ? access === "owner" || access === "maintainer"
    : RANK[access] >= RANK[needed];
};

export const ownerOf = (row: AnyLibraryItemRow): Principal =>
  ({ id: row.ownerId, type: row.ownerType }) as Principal;

const acts = (caller: Caller, principal: Principal): boolean =>
  caller.principals.some(
    (each) => each.type === principal.type && each.id === principal.id
  );

/**
 * What the caller may do with the item, or `null` for nothing (the item is
 * then `NOT_FOUND` to them). A maintainer counts only while they're still in
 * the library that owns the item: someone who left the org keeps no hold on
 * what they published there (D13, "survives your departure").
 */
export const libraryAccessOf = (
  caller: Caller,
  kind: LibraryKind,
  row: AnyLibraryItemRow
): LibraryAccess | null => {
  const owner = ownerOf(row);
  if (owner.type === "user" && owner.id === caller.userId) {
    return "owner";
  }
  if (
    owner.type !== "user" &&
    acts(caller, owner) &&
    row.maintainers.includes(caller.userId)
  ) {
    return "maintainer";
  }
  const query: AccessQuery = {
    grants: caller.grants,
    principals: caller.principals,
    resource: {
      // Maintainers were handled above, to tell them apart from `edit`.
      maintainers: [],
      owner,
      resourceId: row.id,
      resourceType: kind,
    },
    userId: caller.userId,
  };
  const level = accessLevel(query);
  return level === "use" || level === "view" || level === "edit" ? level : null;
};
