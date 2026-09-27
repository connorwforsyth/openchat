import type { UserId } from "@workspace/contract/schemas/common";
import type {
  LibraryAccess,
  LibraryDefinition,
  LibraryItem,
  LibraryKind,
  LibraryVersion,
  McpServerDefinition,
} from "@workspace/contract/schemas/library";
import type { UserSummary } from "@workspace/contract/schemas/tenancy";
import type {
  AnyLibraryItemRow,
  SharingFlags,
  UserSummaryRow,
} from "@workspace/db/queries/library-items";
import { z } from "zod";

import { allows, ownerOf } from "./access";

// Rows to the contract's wire shapes: ISO timestamps, `null` over
// `undefined`, and only what the caller may see.

const urlOrNull = (value: string | null | undefined): string | null =>
  value && z.url().safeParse(value).success ? value : null;

export const toUserSummary = (row: UserSummaryRow): UserSummary => ({
  email: row.email,
  id: row.id as UserId,
  image: urlOrNull(row.image),
  name: row.name,
});

const visibilityOf = (
  kind: LibraryKind,
  row: AnyLibraryItemRow,
  flags: SharingFlags
): LibraryItem["visibility"] => {
  const key = `${kind}:${row.id}`;
  if (flags.linked.has(key)) {
    return "public-link";
  }
  if (row.ownerType !== "user") {
    return "published";
  }
  return flags.granted.has(key) ? "shared" : "private";
};

export interface ItemViewFacts {
  readonly access: LibraryAccess;
  readonly flags: SharingFlags;
  /** Everyone who might be a maintainer, by id. */
  readonly users: ReadonlyMap<string, UserSummary>;
}

export const toLibraryItem = (
  kind: LibraryKind,
  row: AnyLibraryItemRow,
  facts: ItemViewFacts
): LibraryItem => ({
  createdAt: row.createdAt.toISOString(),
  createdBy: row.createdBy,
  description: row.description,
  // The draft is the editors' business.
  draftVersionId: allows(facts.access, "edit") ? row.draftVersionId : null,
  icon: row.icon,
  id: row.id,
  kind,
  latestVersionId: row.latestVersionId,
  latestVersionNumber: row.latestVersionNumber,
  maintainers: row.maintainers.flatMap((id) => {
    const found = facts.users.get(id);
    return found ? [found] : [];
  }),
  myAccess: facts.access,
  name: row.name,
  owner: ownerOf(row),
  publishedFrom: row.publishedFrom,
  updatedAt: row.updatedAt.toISOString(),
  visibility: visibilityOf(kind, row, facts.flags),
});

export interface VersionRowLike {
  readonly createdAt: Date;
  readonly createdBy: UserId;
  readonly id: string;
  readonly itemId: string;
  readonly notes: string | null;
  readonly number: number | null;
  readonly publishedAt: Date | null;
  readonly status: "draft" | "published";
}

export const toLibraryVersion = (
  row: VersionRowLike,
  definition: LibraryDefinition
): LibraryVersion =>
  ({
    createdAt: row.createdAt.toISOString(),
    createdBy: row.createdBy,
    definition,
    id: row.id,
    itemId: row.itemId,
    notes: row.notes,
    number: row.number,
    publishedAt: row.publishedAt?.toISOString() ?? null,
    status: row.status,
  }) as LibraryVersion;

/** A stored MCP definition as returned: whether a header secret is set comes from the sealed column. */
export const mcpDefinitionView = (
  definition: McpServerDefinition,
  hasSecret: boolean
): McpServerDefinition =>
  definition.auth.type === "header"
    ? { ...definition, auth: { ...definition.auth, configured: hasSecret } }
    : definition;
