import type { InfiniteData } from "@tanstack/react-query";
import type {
  GrantId,
  LibraryItemId,
  UserId,
} from "@workspace/contract/schemas/common";
import type {
  CreateGrantInput,
  ResourceGrant,
} from "@workspace/contract/schemas/grants";
import type {
  LibraryDefinition,
  LibraryDefinitionInput,
  LibraryItem,
  LibraryItemDetail,
  LibraryKind,
  LibraryPermission,
  libraryTabSchema,
} from "@workspace/contract/schemas/library";
import { newId } from "@workspace/shared/ids";
import type { z } from "zod";

// Query keys and the pure cache edits behind optimistic mutations (D28): a
// library edit, share or publish changes the TanStack Query cache first and
// is rolled back only if the server refuses. Kept apart from the hooks so
// they're tested without React.

export type LibraryTab = z.infer<typeof libraryTabSchema>;

export interface ListFilter {
  readonly kind?: LibraryKind;
  readonly query?: string;
  readonly tab: LibraryTab;
}

export const libraryKeys = {
  all: ["library"] as const,
  config: ["meta", "config"] as const,
  detail: (id: string, revision: string) =>
    ["library", "item", id, revision] as const,
  /** What a fresh copy left out, set by `useDuplicateItem` for the copy's builder. */
  duplicateNotice: (id: string) => ["library", "duplicate-notice", id] as const,
  grants: (id: string) => ["grants", id] as const,
  item: (id: string) => ["library", "item", id] as const,
  links: (id: string) => ["shareLinks", id] as const,
  list: (filter: ListFilter) => ["library", "list", filter] as const,
  lists: ["library", "list"] as const,
  mcpStatus: (id: string) => ["mcp", id, "status"] as const,
  me: ["me"] as const,
  members: (orgId: string) => ["orgs", orgId, "members"] as const,
  models: ["meta", "models"] as const,
  versions: (id: string) => ["library", "item", id, "versions"] as const,
};

export interface ItemPage {
  readonly items: LibraryItem[];
  readonly nextCursor: string | null;
}

export type ListData = InfiniteData<ItemPage, string | undefined>;

const mapPages = (
  data: ListData | undefined,
  fn: (items: LibraryItem[], index: number) => LibraryItem[]
): ListData | undefined =>
  data
    ? {
        ...data,
        pages: data.pages.map((page, index) => ({
          ...page,
          items: fn(page.items, index),
        })),
      }
    : data;

/** The listing fields an edit can change. */
export type ItemPatch = Partial<
  Pick<LibraryItem, "description" | "icon" | "latestVersionNumber" | "name">
>;

export const patchListItem = (
  data: ListData | undefined,
  id: string,
  patch: ItemPatch
): ListData | undefined =>
  mapPages(data, (items) =>
    items.map((item) => (item.id === id ? { ...item, ...patch } : item))
  );

export const removeListItem = (
  data: ListData | undefined,
  id: string
): ListData | undefined =>
  mapPages(data, (items) => items.filter((item) => item.id !== id));

/** Puts an item at the top of the first page (a new or duplicated item sorts first). */
export const prependListItem = (
  data: ListData | undefined,
  item: LibraryItem
): ListData | undefined =>
  mapPages(data, (items, index) =>
    index === 0 ? [item, ...items.filter((each) => each.id !== item.id)] : items
  );

/** Replaces a placeholder (by id) with what the server returned. */
export const replaceListItem = (
  data: ListData | undefined,
  placeholderId: string,
  item: LibraryItem
): ListData | undefined =>
  mapPages(data, (items) =>
    items.map((each) => (each.id === placeholderId ? item : each))
  );

/**
 * A definition as it will read back after saving `input`: MCP header
 * secrets are write-only, so a value just typed shows as configured.
 */
export const definitionView = (
  input: LibraryDefinitionInput,
  before: LibraryDefinition | null
): LibraryDefinition => {
  if (input.kind !== "mcp_server") {
    return input as LibraryDefinition;
  }
  if (input.auth.type !== "header") {
    return input as LibraryDefinition;
  }
  const kept =
    before?.kind === "mcp_server" &&
    before.url === input.url &&
    before.auth.type === "header" &&
    before.auth.headerName === input.auth.headerName &&
    before.auth.configured;
  return {
    ...input,
    auth: {
      configured: input.auth.value !== undefined || Boolean(kept),
      headerName: input.auth.headerName,
      type: "header",
    },
  };
};

export interface UpdateVariables {
  readonly definition?: LibraryDefinitionInput;
  readonly description?: string;
  readonly icon?: string | null;
  readonly name?: string;
}

/** An item detail with an edit applied, as the server will return it. */
export const applyItemUpdate = (
  detail: LibraryItemDetail | undefined,
  update: UpdateVariables
): LibraryItemDetail | undefined => {
  if (!detail) {
    return detail;
  }
  return {
    ...detail,
    ...(update.name === undefined ? {} : { name: update.name }),
    ...(update.description === undefined
      ? {}
      : { description: update.description }),
    ...(update.icon === undefined ? {} : { icon: update.icon }),
    ...(update.definition === undefined
      ? {}
      : { definition: definitionView(update.definition, detail.definition) }),
    updatedAt: new Date().toISOString(),
  };
};

/** A grant to show while `grants.create` is in flight; replaced by the real one. */
export const pendingGrant = (
  input: CreateGrantInput,
  grantedBy: UserId
): ResourceGrant =>
  ({
    ...input,
    createdAt: new Date().toISOString(),
    grantedBy,
    id: newId("grant") as GrantId,
  }) as ResourceGrant;

/** Share: re-granting a principal replaces its level, so the list keeps one row each. */
export const upsertGrant = (
  grants: readonly ResourceGrant[] | undefined,
  grant: ResourceGrant
): ResourceGrant[] => {
  const rest = (grants ?? []).filter(
    (each) =>
      !(
        each.principal.type === grant.principal.type &&
        each.principal.id === grant.principal.id
      )
  );
  return [...rest, grant];
};

export const setGrantLevel = (
  grants: readonly ResourceGrant[] | undefined,
  id: string,
  permission: LibraryPermission
): ResourceGrant[] =>
  (grants ?? []).map((grant) =>
    grant.id === id ? ({ ...grant, permission } as ResourceGrant) : grant
  );

export const withoutGrant = (
  grants: readonly ResourceGrant[] | undefined,
  id: string
): ResourceGrant[] => (grants ?? []).filter((grant) => grant.id !== id);

/** A library copy to list while `publishToLibrary` is in flight. */
export const pendingCopy = (
  source: LibraryItem,
  target: LibraryItem["owner"],
  userId: UserId
): LibraryItem => ({
  ...source,
  draftVersionId: null,
  id: newId("libraryItem") as LibraryItemId,
  maintainers: source.maintainers.filter((each) => each.id === userId),
  myAccess: "maintainer",
  owner: target,
  publishedFrom: source.id,
  updatedAt: new Date().toISOString(),
  visibility: "published",
});
