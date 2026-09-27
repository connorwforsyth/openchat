import type {
  LibraryItemId,
  LibraryVersionId,
  UserId,
} from "@workspace/contract/schemas/common";
import type {
  GrantableResourceType,
  ResourceRef,
} from "@workspace/contract/schemas/grants";
import type {
  LibraryKind,
  PresetDefinition,
} from "@workspace/contract/schemas/library";
import type { Principal } from "@workspace/contract/schemas/tenancy";
import { type AsyncResult, err, ok } from "@workspace/shared/result";
import {
  and,
  asc,
  desc,
  eq,
  ilike,
  inArray,
  isNull,
  lt,
  or,
  type SQL,
  sql,
} from "drizzle-orm";

import type { Db } from "../client";
import { type NotFoundError, notFound } from "../errors";
import { resourceGrant, shareLink } from "../schema/access";
import { user } from "../schema/auth";
import { skillFile } from "../schema/files";
import {
  agent,
  agentVersion,
  mcpServer,
  preset,
  prompt,
  promptVersion,
  skill,
  skillVersion,
} from "../schema/library";
import { deleteGrantsForResource, heldBy } from "./grants";
import type { CursorKey } from "./page";

// Library reads and writes across every kind (ticket 017): finding an item
// by id alone, listing a tab, and the few writes `library.ts` doesn't have
// (preset edits, deletes, published copies, skill files). Access is decided
// by the caller; these only fetch and store.

// Every item table shares the columns `itemColumns` defines; the versioned
// ones add draft/latest pointers, the others a definition. Queries here only
// touch the shared columns, typed once against `agent`.
const ITEM_TABLES = {
  agent,
  mcp_server: mcpServer,
  preset,
  prompt,
  skill,
} as unknown as Record<LibraryKind, typeof agent>;

const VERSION_TABLES = {
  agent: agentVersion,
  prompt: promptVersion,
  skill: skillVersion,
} as unknown as Record<"agent" | "prompt" | "skill", typeof agentVersion>;

const KINDS = Object.keys(ITEM_TABLES) as LibraryKind[];

/** The columns every kind has, with the version pointers `null` for unversioned kinds. */
export interface AnyLibraryItemRow {
  readonly createdAt: Date;
  readonly createdBy: UserId;
  readonly description: string;
  readonly draftVersionId: LibraryVersionId | null;
  readonly icon: string | null;
  readonly id: LibraryItemId;
  readonly latestVersionId: LibraryVersionId | null;
  readonly latestVersionNumber: number | null;
  readonly maintainers: UserId[];
  readonly name: string;
  readonly ownerId: string;
  readonly ownerType: Principal["type"];
  readonly publishedFrom: LibraryItemId | null;
  readonly updatedAt: Date;
}

export interface FoundLibraryItem {
  readonly kind: LibraryKind;
  readonly row: AnyLibraryItemRow;
}

const shared = (table: typeof agent) => ({
  createdAt: table.createdAt,
  createdBy: table.createdBy,
  description: table.description,
  icon: table.icon,
  id: table.id,
  maintainers: table.maintainers,
  name: table.name,
  ownerId: table.ownerId,
  ownerType: table.ownerType,
  publishedFrom: table.publishedFrom,
  updatedAt: table.updatedAt,
});

const selectFrom = (db: Db, kind: LibraryKind) => {
  const table = ITEM_TABLES[kind];
  const version =
    kind === "agent" || kind === "prompt" || kind === "skill"
      ? VERSION_TABLES[kind]
      : undefined;
  return db
    .select(
      version
        ? {
            ...shared(table),
            draftVersionId: table.draftVersionId,
            latestVersionId: table.latestVersionId,
            latestVersionNumber: sql<
              number | null
            >`(select ${version.number} from ${version} where ${version.id} = ${table.latestVersionId})`,
          }
        : {
            ...shared(table),
            draftVersionId: sql<null>`null`,
            latestVersionId: sql<null>`null`,
            latestVersionNumber: sql<null>`null`,
          }
    )
    .from(table);
};

/**
 * An item by id, whatever its kind. Ids are UUIDv7 across every table, so
 * at most one matches; all five are asked at once.
 */
export const findLibraryItem = async (
  db: Db,
  id: LibraryItemId
): Promise<FoundLibraryItem | undefined> => {
  const found = await Promise.all(
    KINDS.map(async (kind) => {
      const [row] = await selectFrom(db, kind).where(
        eq(ITEM_TABLES[kind].id, id)
      );
      return row ? { kind, row: row as AnyLibraryItemRow } : undefined;
    })
  );
  return found.find((each) => each !== undefined);
};

export interface LibraryItemFilter {
  /** Newest-updated first; rows before this key only. */
  readonly after?: CursorKey;
  /** Items with one of these ids. */
  readonly ids?: readonly string[];
  readonly kind?: LibraryKind;
  /** How many to return; one more is fetched per kind to tell if there's more. */
  readonly limit: number;
  /** Items owned by one of these principals. */
  readonly owners?: readonly Principal[];
  /** Case-insensitive match on the name or description. */
  readonly query?: string;
}

const LIKE_SPECIAL = /[\\%_]/g;

const ownedBy = (table: typeof agent, owners: readonly Principal[]): SQL =>
  owners.length === 0
    ? sql`false`
    : (or(
        ...owners.map((owner) =>
          and(eq(table.ownerType, owner.type), eq(table.ownerId, owner.id))
        )
      ) ?? sql`false`);

/**
 * Items across kinds (or one), newest-updated first, keyset-paged by
 * `(updatedAt, id)`. Returns up to `limit + 1` rows: the extra one only
 * says there is more (`toPage`).
 */
export const listLibraryItems = async (
  db: Db,
  filter: LibraryItemFilter
): Promise<FoundLibraryItem[]> => {
  if (filter.ids?.length === 0 || filter.owners?.length === 0) {
    return [];
  }
  const kinds = filter.kind ? [filter.kind] : KINDS;
  const pattern = filter.query
    ? `%${filter.query.replace(LIKE_SPECIAL, (c) => `\\${c}`)}%`
    : undefined;
  const perKind = await Promise.all(
    kinds.map(async (kind) => {
      const table = ITEM_TABLES[kind];
      const { after } = filter;
      const rows = await selectFrom(db, kind)
        .where(
          and(
            filter.owners ? ownedBy(table, filter.owners) : undefined,
            filter.ids
              ? inArray(table.id, [...filter.ids] as LibraryItemId[])
              : undefined,
            pattern
              ? or(
                  ilike(table.name, pattern),
                  ilike(table.description, pattern)
                )
              : undefined,
            after
              ? or(
                  lt(table.updatedAt, new Date(after.key)),
                  and(
                    eq(table.updatedAt, new Date(after.key)),
                    lt(table.id, after.id as LibraryItemId)
                  )
                )
              : undefined
          )
        )
        .orderBy(desc(table.updatedAt), desc(table.id))
        .limit(filter.limit + 1);
      return rows.map((row) => ({ kind, row: row as AnyLibraryItemRow }));
    })
  );
  return perKind
    .flat()
    .sort(
      (a, b) =>
        b.row.updatedAt.getTime() - a.row.updatedAt.getTime() ||
        b.row.id.localeCompare(a.row.id)
    )
    .slice(0, filter.limit + 1);
};

export interface SharingFlags {
  /** `kind:id` of items with at least one grant. */
  readonly granted: ReadonlySet<string>;
  /** `kind:id` of items with a live share link. */
  readonly linked: ReadonlySet<string>;
}

/** Which of `refs` are shared or have a live public link, for `visibility`. */
export const sharingFlags = async (
  db: Db,
  refs: readonly ResourceRef[],
  now: Date = new Date()
): Promise<SharingFlags> => {
  if (refs.length === 0) {
    return { granted: new Set(), linked: new Set() };
  }
  const ids = [...new Set(refs.map((ref) => ref.resourceId))];
  const [grants, links] = await Promise.all([
    db
      .selectDistinct({
        resourceId: resourceGrant.resourceId,
        resourceType: resourceGrant.resourceType,
      })
      .from(resourceGrant)
      .where(inArray(resourceGrant.resourceId, ids)),
    db
      .selectDistinct({
        resourceId: shareLink.resourceId,
        resourceType: shareLink.resourceType,
      })
      .from(shareLink)
      .where(
        and(
          inArray(shareLink.resourceId, ids),
          isNull(shareLink.revokedAt),
          or(
            isNull(shareLink.expiresAt),
            sql`${shareLink.expiresAt} > ${now.toISOString()}::timestamptz`
          )
        )
      ),
  ]);
  const key = (row: { resourceId: string; resourceType: string }) =>
    `${row.resourceType}:${row.resourceId}`;
  return {
    granted: new Set(grants.map(key)),
    linked: new Set(links.map(key)),
  };
};

/** Library grants held by any of `principals`, as `{ type, id, permission }`. */
export const libraryGrantsFor = (db: Db, principals: readonly Principal[]) =>
  db
    .select()
    .from(resourceGrant)
    .where(
      and(
        heldBy(principals),
        sql`${resourceGrant.resourceType} <> 'conversation'`
      )
    )
    .orderBy(asc(resourceGrant.createdAt));

export type UserSummaryRow = Pick<
  typeof user.$inferSelect,
  "email" | "id" | "image" | "name"
>;

/** Name, email and avatar for each user id that exists, in no particular order. */
export const userSummaries = async (
  db: Db,
  ids: readonly UserId[]
): Promise<UserSummaryRow[]> =>
  ids.length === 0
    ? []
    : await db
        .select({
          email: user.email,
          id: user.id,
          image: user.image,
          name: user.name,
        })
        .from(user)
        .where(inArray(user.id, [...new Set(ids)]));

// --- Writes ---

export interface PublishedCopyFields {
  readonly maintainers: readonly UserId[];
  readonly publishedFrom: LibraryItemId;
}

/** Marks an item as a team or org library's copy of `publishedFrom`, maintained by `maintainers`. */
export const markPublishedCopy = async (
  db: Db,
  kind: LibraryKind,
  id: LibraryItemId,
  fields: PublishedCopyFields
): Promise<void> => {
  const table = ITEM_TABLES[kind];
  await db
    .update(table)
    .set({
      maintainers: [...new Set(fields.maintainers)],
      publishedFrom: fields.publishedFrom,
    })
    .where(eq(table.id, id));
};

/** A library's existing copy of `sourceId`, so publishing again adds a version instead of a duplicate. */
export const findPublishedCopy = async (
  db: Db,
  kind: LibraryKind,
  sourceId: LibraryItemId,
  owner: Principal
): Promise<AnyLibraryItemRow | undefined> => {
  const table = ITEM_TABLES[kind];
  const [row] = await selectFrom(db, kind)
    .where(
      and(
        eq(table.publishedFrom, sourceId),
        eq(table.ownerType, owner.type),
        eq(table.ownerId, owner.id)
      )
    )
    .limit(1);
  return row as AnyLibraryItemRow | undefined;
};

/** Bumps `updatedAt`, so an item whose draft changed sorts first. */
export const touchLibraryItem = async (
  db: Db,
  kind: LibraryKind,
  id: LibraryItemId
): Promise<void> => {
  const table = ITEM_TABLES[kind];
  await db.update(table).set({ updatedAt: new Date() }).where(eq(table.id, id));
};

export const getPreset = async (
  db: Db,
  id: LibraryItemId
): AsyncResult<typeof preset.$inferSelect, NotFoundError> => {
  const [row] = await db.select().from(preset).where(eq(preset.id, id));
  return row ? ok(row) : err(notFound("preset", id));
};

export interface PresetPatch {
  readonly definition?: PresetDefinition;
  readonly description?: string;
  readonly icon?: string | null;
  readonly name?: string;
}

export const updatePreset = async (
  db: Db,
  id: LibraryItemId,
  patch: PresetPatch
): AsyncResult<typeof preset.$inferSelect, NotFoundError> => {
  const [row] = await db
    .update(preset)
    .set({
      ...(patch.name === undefined ? {} : { name: patch.name }),
      ...(patch.description === undefined
        ? {}
        : { description: patch.description }),
      ...(patch.icon === undefined ? {} : { icon: patch.icon }),
      ...(patch.definition === undefined
        ? {}
        : { definition: patch.definition }),
    })
    .where(eq(preset.id, id))
    .returning();
  return row ? ok(row) : err(notFound("preset", id));
};

/** Deletes an MCP server or preset with its grants and share links. */
export const deleteUnversionedItem = (
  db: Db,
  kind: Extract<GrantableResourceType, "mcp_server" | "preset">,
  id: LibraryItemId
): AsyncResult<void, NotFoundError> =>
  db.transaction(async (tx) => {
    const table = kind === "mcp_server" ? mcpServer : preset;
    await deleteGrantsForResource(tx, { resourceId: id, resourceType: kind });
    const deleted = await tx
      .delete(table)
      .where(eq(table.id, id))
      .returning({ id: table.id });
    return deleted.length > 0 ? ok(undefined) : err(notFound(kind, id));
  });

// --- Skill files (`skill_file`): a version's bundled scripts and resources ---

export interface SkillFileEntry {
  readonly fileId: string;
  readonly path: string;
}

/** A skill version's files, by path. */
export const listSkillFiles = async (
  db: Db,
  versionId: LibraryVersionId
): Promise<SkillFileEntry[]> =>
  await db
    .select({ fileId: skillFile.fileId, path: skillFile.path })
    .from(skillFile)
    .where(eq(skillFile.skillVersionId, versionId))
    .orderBy(asc(skillFile.path));

/** Replaces a skill version's files (the draft's, in practice: published ones never change). */
export const replaceSkillFiles = (
  db: Db,
  versionId: LibraryVersionId,
  files: readonly SkillFileEntry[]
): Promise<void> =>
  db.transaction(async (tx) => {
    await tx.delete(skillFile).where(eq(skillFile.skillVersionId, versionId));
    if (files.length > 0) {
      await tx.insert(skillFile).values(
        files.map((each) => ({
          fileId: each.fileId as (typeof skillFile.$inferInsert)["fileId"],
          path: each.path,
          skillVersionId: versionId,
        }))
      );
    }
  });
