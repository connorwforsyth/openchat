import { loadOrgPolicy } from "@workspace/auth/resources";
import type {
  FileId,
  LibraryItemId,
  LibraryVersionId,
  OrgId,
  TeamId,
  UserId,
} from "@workspace/contract/schemas/common";
import type {
  duplicateLibraryItemInputSchema,
  LibraryDefinition,
  LibraryExport,
  LibraryItem,
  LibraryItemDetail,
  LibraryVersion,
  libraryImportInputSchema,
  publishToLibraryInputSchema,
  publishVersionInputSchema,
  restoreVersionInputSchema,
  setMaintainersInputSchema,
} from "@workspace/contract/schemas/library";
import type { Principal } from "@workspace/contract/schemas/tenancy";
import type { Db } from "@workspace/db/client";
import { getReadableFile } from "@workspace/db/queries/files";
import {
  listPublishedVersions,
  publishDraft,
  setMaintainers,
  updateDraft,
  type VersionedKind,
} from "@workspace/db/queries/library";
import {
  findPublishedCopy,
  listSkillFiles,
  markPublishedCopy,
  replaceSkillFiles,
} from "@workspace/db/queries/library-items";
import {
  decodeCursor,
  encodeCursor,
  type Page,
} from "@workspace/db/queries/page";
import { loadPrincipals } from "@workspace/db/queries/teams";
import { team } from "@workspace/db/schema/tenancy";
import {
  type AsyncResult,
  err,
  ok,
  type Result,
} from "@workspace/shared/result";
import { eq } from "drizzle-orm";
import type { z } from "zod";

import { allows, type Caller } from "./access";
import {
  currentDefinition,
  freshDetail,
  informationalGate,
  isVersionedKind,
  itemViews,
  type LibraryDeps,
  loadCaller,
  type Resolved,
  resolveItem,
  versionDefinition,
} from "./core";
import { asInput, prepareDefinition } from "./definitions";
import {
  conflict,
  forbidden,
  fromZod,
  invalid,
  type LibraryError,
} from "./errors";
import { libreChatAgentToDefinition } from "./librechat";
import { type ItemMeta, sealedSecretOf, storeNewItem } from "./store";
import { toLibraryVersion } from "./views";

// Versions, publishing and moving items between libraries (D13, §8 "Share
// vs publish"). Sharing itself is `grants` (ticket 012); this is the other
// half: freezing drafts into versions, and publishing a copy into a team or
// org library that then owns it, with the publisher as a maintainer.

type PublishVersionInput = z.infer<typeof publishVersionInputSchema>;
type PublishToLibraryInput = z.infer<typeof publishToLibraryInputSchema>;
type RestoreInput = z.infer<typeof restoreVersionInputSchema>;
type DuplicateInput = z.infer<typeof duplicateLibraryItemInputSchema>;
type MaintainersInput = z.infer<typeof setMaintainersInputSchema>;
type ImportInput = z.infer<typeof libraryImportInputSchema>;

const now = (deps: LibraryDeps): Date => deps.now?.() ?? new Date();

const orgOfLibrary = async (
  db: Db,
  library: Principal
): Promise<OrgId | undefined> => {
  if (library.type === "org") {
    return library.id;
  }
  if (library.type === "user") {
    return;
  }
  const [row] = await db
    .select({ orgId: team.orgId })
    .from(team)
    .where(eq(team.id, library.id as TeamId));
  return row?.orgId as OrgId | undefined;
};

/**
 * Asks the target library's publish gate (D21). Personal items have no
 * gate; a team uses its org's policy.
 */
const passGate = async (
  deps: LibraryDeps,
  input: {
    readonly itemId: LibraryItemId;
    readonly kind: Resolved["kind"];
    readonly library: Principal;
    readonly publishedBy: UserId;
  }
): AsyncResult<void, LibraryError> => {
  const orgId = await orgOfLibrary(deps.db, input.library);
  if (!orgId) {
    return ok(undefined);
  }
  const policy = await loadOrgPolicy(deps.db, orgId);
  const gate = deps.publishGate ?? informationalGate;
  const passed = await gate({ ...input, policy: policy.publishGate });
  return passed.ok ? ok(undefined) : err(invalid(passed.error.message, ["id"]));
};

/** Gives the fresh draft its published version's skill files (the version keeps its own). */
const carrySkillFiles = async (
  db: Db,
  kind: VersionedKind,
  from: LibraryVersionId,
  to: LibraryVersionId
): Promise<void> => {
  if (kind === "skill") {
    await replaceSkillFiles(db, to, await listSkillFiles(db, from));
  }
};

/**
 * Freezes the draft as the next version and opens a new draft from it.
 * An unchanged draft is a `CONFLICT` (`already_exists`): that version
 * exists already.
 */
export const publishVersion = async (
  deps: LibraryDeps,
  userId: UserId,
  input: PublishVersionInput
): AsyncResult<LibraryVersion, LibraryError> => {
  const resolved = await resolveItem(deps.db, userId, input.id, "edit");
  if (!resolved.ok) {
    return resolved;
  }
  const { kind, row } = resolved.value;
  if (!isVersionedKind(kind)) {
    return err(
      invalid("Only agents, prompts and skills have versions.", ["id"])
    );
  }
  if (row.ownerType !== "user") {
    const gate = await passGate(deps, {
      itemId: row.id,
      kind,
      library: { id: row.ownerId, type: row.ownerType } as Principal,
      publishedBy: userId,
    });
    if (!gate.ok) {
      return gate;
    }
  }
  const published = await publishDraft(
    deps.db,
    kind,
    row.id,
    { notes: input.notes ?? null, publishedBy: userId },
    now(deps)
  );
  if (!published.ok) {
    return err(
      published.error.type === "conflict"
        ? conflict("already_exists")
        : { type: "not_found" }
    );
  }
  const { draft, version } = published.value;
  await carrySkillFiles(deps.db, kind, version.id, draft.id);
  const loaded = await versionDefinition(deps.db, kind, row.id, version.id);
  if (!loaded) {
    return err({ type: "not_found" });
  }
  return ok(toLibraryVersion(loaded.row, loaded.definition));
};

/** Whether the caller is in the target library (a team, its ancestors via membership below, or the org). */
const inLibrary = (
  principals: readonly Principal[],
  target: Principal
): boolean =>
  principals.some((each) => each.type === target.type && each.id === target.id);

/** What publishing copies: a published version (versioned kinds), or the item as it is. */
const publishableContent = async (
  db: Db,
  source: Resolved,
  pinned: LibraryVersionId | undefined
): AsyncResult<
  { readonly definition: LibraryDefinition; readonly notes: string | null },
  LibraryError
> => {
  if (!isVersionedKind(source.kind)) {
    const current = await currentDefinition(db, source, true);
    return current
      ? ok({ definition: current.definition, notes: null })
      : err({ type: "not_found" });
  }
  const versionId = pinned ?? source.row.latestVersionId;
  const loaded = versionId
    ? await versionDefinition(db, source.kind, source.row.id, versionId)
    : undefined;
  if (loaded?.row.status !== "published") {
    return err(
      invalid("Publish a version before publishing it to a library.", [
        "versionId",
      ])
    );
  }
  return ok({ definition: loaded.definition, notes: loaded.row.notes });
};

/**
 * Publish (D13): copy a published version into a team or org library. The
 * library owns the copy and the caller maintains it, so it outlives their
 * membership. Publishing the same item to the same library again adds a
 * version to the existing copy.
 */
export const publishToLibrary = async (
  deps: LibraryDeps,
  userId: UserId,
  input: PublishToLibraryInput
): AsyncResult<LibraryItemDetail, LibraryError> => {
  const { db } = deps;
  const resolved = await resolveItem(db, userId, input.id, "manage");
  if (!resolved.ok) {
    return resolved;
  }
  const source = resolved.value;
  const target = input.target as Principal;
  if (!inLibrary(source.caller.principals, target)) {
    return err(
      invalid("You can only publish to a team or org you're in.", ["target"])
    );
  }
  if (
    source.row.ownerType === target.type &&
    source.row.ownerId === target.id
  ) {
    return err(invalid("It's already in that library.", ["target"]));
  }

  const content = await publishableContent(db, source, input.versionId);
  if (!content.ok) {
    return content;
  }
  const { definition, notes } = content.value;

  const gate = await passGate(deps, {
    itemId: source.row.id,
    kind: source.kind,
    library: target,
    publishedBy: userId,
  });
  if (!gate.ok) {
    return gate;
  }

  const existing = await findPublishedCopy(
    db,
    source.kind,
    source.row.id,
    target
  );
  if (existing) {
    if (!existing.maintainers.includes(userId)) {
      return err(forbidden());
    }
    return await republish(
      deps,
      userId,
      existing.id,
      source.kind,
      definition,
      notes
    );
  }

  // The copy is checked like any new definition, as the publisher: its
  // references are ones they can already use.
  const prepared = await prepareDefinition(
    deps,
    source.caller,
    asInput(definition),
    { definition, hasSecret: true }
  );
  if (!prepared.ok) {
    return prepared;
  }
  const copiedSecret =
    source.kind === "mcp_server"
      ? await sealedSecretOf(db, source.row.id)
      : undefined;
  const copyId = await db.transaction(async (tx) => {
    const id = await storeNewItem(tx as unknown as Db, {
      copiedSecret,
      createdBy: userId,
      meta: {
        description: source.row.description,
        icon: source.row.icon,
        name: source.row.name,
      },
      owner: target,
      prepared: prepared.value,
    });
    await markPublishedCopy(tx as unknown as Db, source.kind, id, {
      maintainers: [userId],
      publishedFrom: source.row.id,
    });
    if (isVersionedKind(source.kind)) {
      const published = await publishDraft(
        tx as unknown as Db,
        source.kind,
        id,
        { notes, publishedBy: userId },
        now(deps)
      );
      if (published.ok) {
        await carrySkillFiles(
          tx as unknown as Db,
          source.kind,
          published.value.version.id,
          published.value.draft.id
        );
      }
    }
    return id;
  });
  return await freshDetail(db, userId, copyId, "latest");
};

const republish = async (
  deps: LibraryDeps,
  userId: UserId,
  copyId: LibraryItemId,
  kind: Resolved["kind"],
  definition: LibraryDefinition,
  notes: string | null
): AsyncResult<LibraryItemDetail, LibraryError> => {
  const { db } = deps;
  if (isVersionedKind(kind)) {
    const { files, ...stored } =
      definition.kind === "skill"
        ? definition
        : { ...definition, files: undefined };
    const draft = await updateDraft(db, kind, copyId, stored as never);
    if (draft.ok && files) {
      await replaceSkillFiles(db, draft.value.id, files);
    }
    const published = await publishDraft(
      db,
      kind,
      copyId,
      { notes, publishedBy: userId },
      now(deps)
    );
    // Unchanged since the last publish: the copy already has this version.
    if (published.ok) {
      await carrySkillFiles(
        db,
        kind,
        published.value.version.id,
        published.value.draft.id
      );
    }
  }
  return await freshDetail(db, userId, copyId, "latest");
};

/** Published versions newest first, then the draft (for editors). Needs `view`. */
export const listVersions = async (
  deps: LibraryDeps,
  userId: UserId,
  input: {
    readonly cursor?: string;
    readonly id: LibraryItemId;
    readonly limit: number;
  }
): AsyncResult<Page<LibraryVersion>, LibraryError> => {
  const { db } = deps;
  const resolved = await resolveItem(db, userId, input.id, "view");
  if (!resolved.ok) {
    return resolved;
  }
  const item = resolved.value;
  if (!isVersionedKind(item.kind)) {
    return ok({ items: [], nextCursor: null });
  }
  let offset = 0;
  if (input.cursor) {
    const decoded = decodeCursor(input.cursor);
    if (!decoded.ok || typeof decoded.value.key !== "number") {
      return err(invalid("Unknown cursor.", ["cursor"]));
    }
    offset = decoded.value.key;
  }
  const published = await listPublishedVersions(db, item.kind, item.row.id);
  const ids: LibraryVersionId[] = [
    ...published.map((row) => row.id),
    ...(allows(item.access, "edit") && item.row.draftVersionId
      ? [item.row.draftVersionId]
      : []),
  ];
  const slice = ids.slice(offset, offset + input.limit);
  const loaded = await Promise.all(
    slice.map((id) =>
      versionDefinition(db, item.kind as VersionedKind, item.row.id, id)
    )
  );
  const items = loaded.flatMap((each) =>
    each ? [toLibraryVersion(each.row, each.definition)] : []
  );
  const last = slice.at(-1);
  return ok({
    items,
    nextCursor:
      offset + input.limit < ids.length && last
        ? encodeCursor({ id: last, key: offset + input.limit })
        : null,
  });
};

/** One version. The draft takes `edit`, published ones `view`. */
export const getVersionOf = async (
  deps: LibraryDeps,
  userId: UserId,
  input: { readonly id: LibraryItemId; readonly versionId: LibraryVersionId }
): AsyncResult<LibraryVersion, LibraryError> => {
  const resolved = await resolveItem(deps.db, userId, input.id, "view");
  if (!resolved.ok) {
    return resolved;
  }
  const item = resolved.value;
  if (!isVersionedKind(item.kind)) {
    return err({ type: "not_found" });
  }
  const loaded = await versionDefinition(
    deps.db,
    item.kind,
    item.row.id,
    input.versionId
  );
  if (!loaded) {
    return err({ type: "not_found" });
  }
  if (loaded.row.status === "draft" && !allows(item.access, "edit")) {
    return err(forbidden());
  }
  return ok(toLibraryVersion(loaded.row, loaded.definition));
};

/** Copies a published version into the draft, to edit from there. */
export const restoreVersion = async (
  deps: LibraryDeps,
  userId: UserId,
  input: RestoreInput
): AsyncResult<LibraryItemDetail, LibraryError> => {
  const { db } = deps;
  const resolved = await resolveItem(db, userId, input.id, "edit");
  if (!resolved.ok) {
    return resolved;
  }
  const item = resolved.value;
  if (!isVersionedKind(item.kind)) {
    return err(
      invalid("Only agents, prompts and skills have versions.", ["id"])
    );
  }
  const loaded = await versionDefinition(
    db,
    item.kind,
    item.row.id,
    input.versionId
  );
  if (loaded?.row.status !== "published") {
    return err({ type: "not_found" });
  }
  const { definition } = loaded;
  const stored =
    definition.kind === "skill"
      ? { kind: definition.kind, skillMd: definition.skillMd }
      : definition;
  const draft = await updateDraft(db, item.kind, item.row.id, stored as never);
  if (draft.ok && definition.kind === "skill") {
    await replaceSkillFiles(db, draft.value.id, definition.files);
  }
  return await freshDetail(db, userId, item.row.id, "draft");
};

/** Sets who maintains a published item. Each must be in the library that owns it. */
export const setItemMaintainers = async (
  deps: LibraryDeps,
  userId: UserId,
  input: MaintainersInput
): AsyncResult<LibraryItem, LibraryError> => {
  const { db } = deps;
  const resolved = await resolveItem(db, userId, input.id, "manage");
  if (!resolved.ok) {
    return resolved;
  }
  const item = resolved.value;
  if (item.row.ownerType === "user") {
    return err(invalid("Only published items have maintainers.", ["id"]));
  }
  const owner = { id: item.row.ownerId, type: item.row.ownerType } as Principal;
  const members = await Promise.all(
    input.userIds.map(async (id) =>
      inLibrary(await loadPrincipals(db, id), owner)
    )
  );
  const outside = members.indexOf(false);
  if (outside >= 0) {
    return err(
      invalid("Maintainers must be in the library's team or org.", [
        "userIds",
        outside,
      ])
    );
  }
  const updated = await setMaintainers(
    db,
    item.kind as VersionedKind,
    item.row.id,
    input.userIds
  );
  if (!updated.ok) {
    return err({ type: "not_found" });
  }
  const refreshed = await resolveItem(db, userId, item.row.id);
  if (!refreshed.ok) {
    // The caller removed themselves: they no longer manage it, but the change stands.
    const [view] = await itemViews(db, [
      {
        ...item,
        access: "use",
        row: { ...item.row, maintainers: [...input.userIds] },
      },
    ]);
    return view ? ok(view) : err({ type: "not_found" });
  }
  const [view] = await itemViews(db, [refreshed.value]);
  return view ? ok(view) : err({ type: "not_found" });
};

/** The content a copy takes: the latest published version, or the draft for editors. */
const copyableDefinition = async (
  db: Db,
  item: Resolved
): Promise<LibraryDefinition | undefined> =>
  (await currentDefinition(db, item, allows(item.access, "edit")))?.definition;

/** Copies an item into the caller's own library as a new draft. Needs `view`. */
export const duplicateItem = async (
  deps: LibraryDeps,
  userId: UserId,
  input: DuplicateInput
): AsyncResult<LibraryItemDetail, LibraryError> => {
  const { db } = deps;
  const resolved = await resolveItem(db, userId, input.id, "view");
  if (!resolved.ok) {
    return resolved;
  }
  const item = resolved.value;
  const definition = await copyableDefinition(db, item);
  if (!definition) {
    return err(invalid("There's no published version to copy yet.", ["id"]));
  }
  // Knowledge and skill files come along: `view` may read them (D13). A
  // header secret doesn't: the copy's owner sets their own.
  const prepared = await prepareDefinition(
    deps,
    item.caller,
    asInput(definition),
    { definition, hasSecret: false }
  );
  if (!prepared.ok) {
    return prepared;
  }
  const id = await storeNewItem(db, {
    createdBy: userId,
    meta: {
      description: item.row.description,
      icon: item.row.icon,
      name: input.name ?? item.row.name,
    },
    owner: { id: userId, type: "user" },
    prepared: prepared.value,
  });
  return await freshDetail(db, userId, id, "draft");
};

/** The portable export of an item. Needs `view`; secrets never leave. */
export const exportItem = async (
  deps: LibraryDeps,
  userId: UserId,
  input: { readonly id: LibraryItemId }
): AsyncResult<LibraryExport, LibraryError> => {
  const resolved = await resolveItem(deps.db, userId, input.id, "view");
  if (!resolved.ok) {
    return resolved;
  }
  const item = resolved.value;
  const definition = await copyableDefinition(deps.db, item);
  if (!definition) {
    return err(invalid("There's no published version to export yet.", ["id"]));
  }
  return ok(toExport(item.row, definition, now(deps)));
};

export const toExport = (
  row: {
    readonly description: string;
    readonly icon: string | null;
    readonly name: string;
  },
  definition: LibraryDefinition,
  at: Date
): LibraryExport => ({
  definition:
    definition.kind === "mcp_server" && definition.auth.type === "header"
      ? { ...definition, auth: { ...definition.auth, configured: false } }
      : definition,
  description: row.description,
  exportedAt: at.toISOString(),
  format: "native",
  formatVersion: 1,
  icon: row.icon,
  name: row.name,
});

/** The item a document describes, before any reference is checked. */
const importedContent = (
  deps: LibraryDeps,
  document: ImportInput["document"]
): Result<
  {
    readonly definition: LibraryDefinition;
    readonly meta: ItemMeta;
  },
  LibraryError
> => {
  if (document.format === "native") {
    const { definition, description, icon, name } = document;
    return ok({ definition, meta: { description, icon, name } });
  }
  const mapped = libreChatAgentToDefinition(
    document.data,
    deps.defaultModel ?? "auto"
  );
  if (!mapped.success) {
    return err(fromZod(mapped.error, ["document", "data"]));
  }
  const { definition, description, icon, name } = mapped.data;
  return ok({ definition, meta: { description, icon, name } });
};

/**
 * Imports our own export or a LibreChat agent as a new personal draft.
 * File references that don't resolve for the caller (another instance's
 * ids) are dropped rather than failing the import.
 */
export const importItem = async (
  deps: LibraryDeps,
  userId: UserId,
  input: ImportInput
): AsyncResult<LibraryItemDetail, LibraryError> => {
  const content = importedContent(deps, input.document);
  if (!content.ok) {
    return content;
  }
  const { definition, meta } = content.value;
  const caller = await loadCaller(deps.db, userId, []);
  const portable = await dropUnreachable(deps.db, caller, definition);
  const prepared = await prepareDefinition(deps, caller, asInput(portable));
  if (!prepared.ok) {
    return prepared;
  }
  const id = await storeNewItem(deps.db, {
    createdBy: userId,
    meta,
    owner: { id: userId, type: "user" },
    prepared: prepared.value,
  });
  return await freshDetail(deps.db, userId, id, "draft");
};

/** Keeps only the references that resolve for the caller on this instance. */
const dropUnreachable = async (
  db: Db,
  caller: Caller,
  definition: LibraryDefinition
): Promise<LibraryDefinition> => {
  const viewer = { principals: caller.principals, userId: caller.userId };
  const readable = async (id: string) =>
    (await getReadableFile(db, viewer, id as FileId)).ok;
  const usable = async (id: string, kind: "mcp_server" | "skill") => {
    const found = await resolveItem(db, caller.userId, id as LibraryItemId);
    return found.ok && found.value.kind === kind;
  };
  if (definition.kind === "agent") {
    const [files, servers, skills] = await Promise.all([
      Promise.all(definition.knowledgeFileIds.map(readable)),
      Promise.all(
        definition.mcpServers.map((each) => usable(each.id, "mcp_server"))
      ),
      Promise.all(definition.skills.map((each) => usable(each.id, "skill"))),
    ]);
    return {
      ...definition,
      knowledgeFileIds: definition.knowledgeFileIds.filter((_, i) => files[i]),
      mcpServers: definition.mcpServers.filter((_, i) => servers[i]),
      skills: definition.skills.filter((_, i) => skills[i]),
    };
  }
  if (definition.kind === "skill") {
    const keep = await Promise.all(
      definition.files.map((each) => readable(each.fileId))
    );
    return { ...definition, files: definition.files.filter((_, i) => keep[i]) };
  }
  return definition;
};
