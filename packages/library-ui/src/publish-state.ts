import {
  isVersionedLibraryKind,
  type LibraryItem,
  type LibraryKind,
} from "@workspace/contract/schemas/library";

// Where a versioned item stands for the person editing it (D13): drafts are
// theirs, publishing is what shares a version with the team. Derived from
// the item alone, so the builder never tracks it separately.

export type PublishState =
  | { readonly type: "new" }
  | {
      readonly type: "draft";
      /** Whether anyone besides its owner can see it yet. */
      readonly shared: boolean;
    }
  | { readonly type: "published"; readonly version: number };

/** `null` for kinds without versions (MCP servers, presets). */
export const publishStateOf = (
  kind: LibraryKind,
  item: Pick<LibraryItem, "latestVersionNumber" | "visibility"> | null
): PublishState | null => {
  if (!isVersionedLibraryKind(kind)) {
    return null;
  }
  if (item === null) {
    return { type: "new" };
  }
  if (item.latestVersionNumber === null) {
    return { shared: item.visibility !== "private", type: "draft" };
  }
  return { type: "published", version: item.latestVersionNumber };
};
