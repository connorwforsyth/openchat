import type {
  LibraryItemId,
  LibraryVersionId,
  UserId,
} from "@workspace/contract/schemas/common";
import type {
  AgentDefinition,
  McpServerDefinition,
  PresetDefinition,
  PromptDefinition,
  SkillDefinition,
} from "@workspace/contract/schemas/library";
import type { Principal } from "@workspace/contract/schemas/tenancy";
import { type AsyncResult, err, ok } from "@workspace/shared/result";
import { and, asc, desc, eq, isNotNull, max } from "drizzle-orm";

import type { Db } from "../client";
import {
  type ConflictError,
  conflict,
  type NotFoundError,
  notFound,
} from "../errors";
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
import { deleteGrantsForResource } from "./grants";

// Library items (D13). Agents, prompts and skills keep one editable draft
// and a numbered series of published versions; publishing freezes the draft
// and opens a fresh one from it. MCP servers and presets are edited in
// place. Access (grants, maintainers) is checked by the caller.

/** The definition each versioned kind stores in its `*_version` rows. */
export interface VersionedDefinitions {
  readonly agent: AgentDefinition;
  readonly prompt: PromptDefinition;
  /** `SKILL.md`; bundled files are `skill_file` rows. */
  readonly skill: Omit<SkillDefinition, "files">;
}
export type VersionedKind = keyof VersionedDefinitions;

// The three item tables share every column, as do the three version tables;
// only the name and the definition's type differ. The code below is written
// once against the agent tables and typed per kind at the edges.
const TABLES = {
  agent: { item: agent, version: agentVersion },
  prompt: { item: prompt, version: promptVersion },
  skill: { item: skill, version: skillVersion },
} as unknown as Record<
  VersionedKind,
  { readonly item: typeof agent; readonly version: typeof agentVersion }
>;

type ItemRow = typeof agent.$inferSelect;
type AgentVersionRow = typeof agentVersion.$inferSelect;

export type LibraryItemRow = ItemRow;
export type LibraryVersionRow<K extends VersionedKind> = Omit<
  AgentVersionRow,
  "definition"
> & { readonly definition: VersionedDefinitions[K] };

export interface NewLibraryItem<D> {
  readonly createdBy: UserId;
  readonly definition: D;
  readonly description?: string;
  readonly icon?: string | null;
  readonly name: string;
  readonly owner: Principal;
}

export interface CreatedItem<K extends VersionedKind> {
  readonly draft: LibraryVersionRow<K>;
  readonly item: LibraryItemRow;
}

/** Creates an item and its first draft. */
export const createVersionedItem = <K extends VersionedKind>(
  db: Db,
  kind: K,
  input: NewLibraryItem<VersionedDefinitions[K]>
): Promise<CreatedItem<K>> =>
  db.transaction(async (tx) => {
    const { item, version } = TABLES[kind];
    const [created] = await tx
      .insert(item)
      .values({
        createdBy: input.createdBy,
        description: input.description ?? "",
        icon: input.icon ?? null,
        name: input.name,
        ownerId: input.owner.id,
        ownerType: input.owner.type,
      })
      .returning();
    if (!created) {
      throw new Error("insert returned no row");
    }
    const [draft] = await tx
      .insert(version)
      .values({
        createdBy: input.createdBy,
        definition: input.definition as AgentDefinition,
        itemId: created.id,
        status: "draft",
      })
      .returning();
    if (!draft) {
      throw new Error("insert returned no row");
    }
    const [withDraft] = await tx
      .update(item)
      .set({ draftVersionId: draft.id })
      .where(eq(item.id, created.id))
      .returning();
    return {
      draft: draft as LibraryVersionRow<K>,
      item: withDraft ?? created,
    };
  });

export const getVersionedItem = async (
  db: Db,
  kind: VersionedKind,
  id: LibraryItemId
): AsyncResult<LibraryItemRow, NotFoundError> => {
  const { item } = TABLES[kind];
  const [row] = await db.select().from(item).where(eq(item.id, id));
  return row ? ok(row) : err(notFound(kind, id));
};

/** Items owned by a user, team or org (a personal library, or a team's). */
export const listOwnedItems = (
  db: Db,
  kind: VersionedKind,
  owner: Principal
): Promise<LibraryItemRow[]> => {
  const { item } = TABLES[kind];
  return db
    .select()
    .from(item)
    .where(and(eq(item.ownerType, owner.type), eq(item.ownerId, owner.id)))
    .orderBy(desc(item.updatedAt), desc(item.id));
};

export interface ItemPatch {
  readonly description?: string;
  readonly icon?: string | null;
  readonly name?: string;
}

export const updateItemMeta = async (
  db: Db,
  kind: VersionedKind,
  id: LibraryItemId,
  patch: ItemPatch
): AsyncResult<LibraryItemRow, NotFoundError> => {
  const { item } = TABLES[kind];
  const [row] = await db
    .update(item)
    .set({
      ...(patch.name === undefined ? {} : { name: patch.name }),
      ...(patch.description === undefined
        ? {}
        : { description: patch.description }),
      ...(patch.icon === undefined ? {} : { icon: patch.icon }),
    })
    .where(eq(item.id, id))
    .returning();
  return row ? ok(row) : err(notFound(kind, id));
};

/** Replaces the draft's definition; published versions never change. */
export const updateDraft = async <K extends VersionedKind>(
  db: Db,
  kind: K,
  itemId: LibraryItemId,
  definition: VersionedDefinitions[K]
): AsyncResult<LibraryVersionRow<K>, NotFoundError> => {
  const { version } = TABLES[kind];
  const [row] = await db
    .update(version)
    .set({ definition: definition as AgentDefinition })
    .where(and(eq(version.itemId, itemId), eq(version.status, "draft")))
    .returning();
  return row ? ok(row as LibraryVersionRow<K>) : err(notFound(kind, itemId));
};

export interface PublishInput {
  readonly notes?: string | null;
  readonly publishedBy: UserId;
}

export interface Published<K extends VersionedKind> {
  /** The fresh draft, a copy of what was published. */
  readonly draft: LibraryVersionRow<K>;
  readonly version: LibraryVersionRow<K>;
}

/**
 * Freezes the draft as the next version number and opens a new draft from
 * it. The item row is locked first, so two publishes can't take the same
 * number. Publishing a draft identical to the latest version is a
 * `nothing_to_publish` conflict.
 */
export const publishDraft = <K extends VersionedKind>(
  db: Db,
  kind: K,
  itemId: LibraryItemId,
  input: PublishInput,
  now: Date = new Date()
): AsyncResult<Published<K>, NotFoundError | ConflictError> =>
  db.transaction(async (tx) => {
    const { item, version } = TABLES[kind];
    const [locked] = await tx
      .select()
      .from(item)
      .where(eq(item.id, itemId))
      .for("update");
    const [draft] = locked
      ? await tx
          .select()
          .from(version)
          .where(and(eq(version.itemId, itemId), eq(version.status, "draft")))
      : [];
    if (!(locked && draft)) {
      return err(notFound(kind, itemId));
    }
    if (locked.latestVersionId) {
      const [latest] = await tx
        .select({ definition: version.definition })
        .from(version)
        .where(eq(version.id, locked.latestVersionId));
      if (
        latest &&
        JSON.stringify(latest.definition) === JSON.stringify(draft.definition)
      ) {
        return err(conflict("nothing_to_publish"));
      }
    }
    const [top] = await tx
      .select({ number: max(version.number) })
      .from(version)
      .where(eq(version.itemId, itemId));
    const [published] = await tx
      .update(version)
      .set({
        notes: input.notes ?? null,
        number: (top?.number ?? 0) + 1,
        publishedAt: now,
        status: "published",
      })
      .where(eq(version.id, draft.id))
      .returning();
    const [nextDraft] = await tx
      .insert(version)
      .values({
        createdBy: input.publishedBy,
        definition: draft.definition,
        itemId,
        status: "draft",
      })
      .returning();
    if (!(published && nextDraft)) {
      throw new Error("publish wrote no row");
    }
    await tx
      .update(item)
      .set({ draftVersionId: nextDraft.id, latestVersionId: published.id })
      .where(eq(item.id, itemId));
    return ok({
      draft: nextDraft as LibraryVersionRow<K>,
      version: published as LibraryVersionRow<K>,
    });
  });

export const getVersion = async <K extends VersionedKind>(
  db: Db,
  kind: K,
  id: LibraryVersionId
): AsyncResult<LibraryVersionRow<K>, NotFoundError> => {
  const { version } = TABLES[kind];
  const [row] = await db.select().from(version).where(eq(version.id, id));
  return row
    ? ok(row as LibraryVersionRow<K>)
    : err(notFound(`${kind}_version`, id));
};

/** Published versions, newest first. */
export const listPublishedVersions = async <K extends VersionedKind>(
  db: Db,
  kind: K,
  itemId: LibraryItemId
): Promise<LibraryVersionRow<K>[]> => {
  const { version } = TABLES[kind];
  const rows = await db
    .select()
    .from(version)
    .where(and(eq(version.itemId, itemId), isNotNull(version.number)))
    .orderBy(desc(version.number));
  return rows as LibraryVersionRow<K>[];
};

/**
 * What a consumer runs: the pinned version if given and published, else
 * the latest published one. Never the draft.
 */
export const resolvePublishedVersion = async <K extends VersionedKind>(
  db: Db,
  kind: K,
  itemId: LibraryItemId,
  pinned?: LibraryVersionId
): AsyncResult<LibraryVersionRow<K>, NotFoundError> => {
  const { version } = TABLES[kind];
  const [row] = await db
    .select()
    .from(version)
    .where(
      and(
        eq(version.itemId, itemId),
        eq(version.status, "published"),
        pinned === undefined ? undefined : eq(version.id, pinned)
      )
    )
    .orderBy(desc(version.number))
    .limit(1);
  return row
    ? ok(row as LibraryVersionRow<K>)
    : err(notFound(`${kind}_version`, pinned ?? itemId));
};

/** Deletes an item, its versions, and its grants and share links. */
export const deleteVersionedItem = (
  db: Db,
  kind: VersionedKind,
  id: LibraryItemId
): AsyncResult<void, NotFoundError> =>
  db.transaction(async (tx) => {
    const { item } = TABLES[kind];
    await deleteGrantsForResource(tx, { resourceId: id, resourceType: kind });
    const deleted = await tx
      .delete(item)
      .where(eq(item.id, id))
      .returning({ id: item.id });
    return deleted.length > 0 ? ok(undefined) : err(notFound(kind, id));
  });

/** Sets who maintains a published item. */
export const setMaintainers = async (
  db: Db,
  kind: VersionedKind,
  id: LibraryItemId,
  userIds: readonly UserId[]
): AsyncResult<LibraryItemRow, NotFoundError> => {
  const { item } = TABLES[kind];
  const [row] = await db
    .update(item)
    .set({ maintainers: [...new Set(userIds)] })
    .where(eq(item.id, id))
    .returning();
  return row ? ok(row) : err(notFound(kind, id));
};

// --- Unversioned: MCP servers and presets ---

export type McpServerRow = typeof mcpServer.$inferSelect;
export type PresetRow = typeof preset.$inferSelect;

export interface NewMcpServer extends NewLibraryItem<McpServerDefinition> {
  /** A sealed header secret and the key id that sealed it (D24). */
  readonly secret?: { readonly ciphertext: string; readonly keyId: string };
}

export const createMcpServer = async (
  db: Db,
  input: NewMcpServer
): Promise<McpServerRow> => {
  const [row] = await db
    .insert(mcpServer)
    .values({
      createdBy: input.createdBy,
      definition: input.definition,
      description: input.description ?? "",
      icon: input.icon ?? null,
      name: input.name,
      ownerId: input.owner.id,
      ownerType: input.owner.type,
      secretCiphertext: input.secret?.ciphertext ?? null,
      secretKeyId: input.secret?.keyId ?? null,
    })
    .returning();
  if (!row) {
    throw new Error("insert returned no row");
  }
  return row;
};

export interface McpServerPatch extends ItemPatch {
  readonly definition?: McpServerDefinition;
  /** `null` clears the secret; omitted keeps it. */
  readonly secret?: {
    readonly ciphertext: string;
    readonly keyId: string;
  } | null;
}

export const updateMcpServer = async (
  db: Db,
  id: LibraryItemId,
  patch: McpServerPatch
): AsyncResult<McpServerRow, NotFoundError> => {
  const [row] = await db
    .update(mcpServer)
    .set({
      ...(patch.name === undefined ? {} : { name: patch.name }),
      ...(patch.description === undefined
        ? {}
        : { description: patch.description }),
      ...(patch.icon === undefined ? {} : { icon: patch.icon }),
      ...(patch.definition === undefined
        ? {}
        : { definition: patch.definition }),
      ...(patch.secret === undefined
        ? {}
        : {
            secretCiphertext: patch.secret?.ciphertext ?? null,
            secretKeyId: patch.secret?.keyId ?? null,
          }),
    })
    .where(eq(mcpServer.id, id))
    .returning();
  return row ? ok(row) : err(notFound("mcp_server", id));
};

export const createPreset = async (
  db: Db,
  input: NewLibraryItem<PresetDefinition>
): Promise<PresetRow> => {
  const [row] = await db
    .insert(preset)
    .values({
      createdBy: input.createdBy,
      definition: input.definition,
      description: input.description ?? "",
      icon: input.icon ?? null,
      name: input.name,
      ownerId: input.owner.id,
      ownerType: input.owner.type,
    })
    .returning();
  if (!row) {
    throw new Error("insert returned no row");
  }
  return row;
};

export const listMcpServers = (
  db: Db,
  owner: Principal
): Promise<McpServerRow[]> =>
  db
    .select()
    .from(mcpServer)
    .where(
      and(eq(mcpServer.ownerType, owner.type), eq(mcpServer.ownerId, owner.id))
    )
    .orderBy(asc(mcpServer.name));

export const listPresets = (db: Db, owner: Principal): Promise<PresetRow[]> =>
  db
    .select()
    .from(preset)
    .where(and(eq(preset.ownerType, owner.type), eq(preset.ownerId, owner.id)))
    .orderBy(asc(preset.name));
