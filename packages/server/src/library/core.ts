import type { GrantFact } from "@workspace/auth/access";
import type {
  LibraryItemId,
  LibraryVersionId,
  UserId,
} from "@workspace/contract/schemas/common";
import type { ResourceRef } from "@workspace/contract/schemas/grants";
import type {
  LibraryAccess,
  LibraryDefinition,
  LibraryItem,
  LibraryItemDetail,
  LibraryKind,
  UserServerPolicy,
} from "@workspace/contract/schemas/library";
import type { ModelSelector } from "@workspace/contract/schemas/models";
import type {
  Principal,
  PublishGate,
} from "@workspace/contract/schemas/tenancy";
import type { Db } from "@workspace/db/client";
import {
  type GrantRow,
  listGrantsForPrincipals,
} from "@workspace/db/queries/grants";
import { getVersion, type VersionedKind } from "@workspace/db/queries/library";
import {
  type FoundLibraryItem,
  findLibraryItem,
  getPreset,
  libraryGrantsFor,
  listSkillFiles,
  sharingFlags,
  userSummaries,
} from "@workspace/db/queries/library-items";
import { getMcpServer } from "@workspace/db/queries/mcp";
import { loadPrincipals } from "@workspace/db/queries/teams";
import type { CryptoError, KeyRing } from "@workspace/mcp/crypto";
import {
  type AsyncResult,
  err,
  ok,
  type Result,
} from "@workspace/shared/result";

import { allows, type Caller, libraryAccessOf } from "./access";
import { type LibraryError, notFound } from "./errors";
import {
  mcpDefinitionView,
  toLibraryItem,
  toUserSummary,
  type VersionRowLike,
} from "./views";

// The shared machinery of the library shell: who the caller is, finding an
// item with the caller's access to it, loading a definition, and building
// the contract's views. The handlers in `items.ts` and `publishing.ts` are
// written against these.

/** What a library publish gate (D21) is asked before an item enters a team or org library. */
export interface PublishGateInput {
  readonly itemId: LibraryItemId;
  readonly kind: LibraryKind;
  readonly library: Principal;
  /** The library's policy (`orgSettings.publishGate`). */
  readonly policy: PublishGate;
  readonly publishedBy: UserId;
}

/**
 * The publish-gate hook. The Agents+ wave runs the item's test set here and
 * refuses a regressing publish under `no-regressions`; until then every
 * policy is informational and the default lets everything through.
 */
export type PublishGateCheck = (
  input: PublishGateInput
) => AsyncResult<void, { readonly message: string }>;

export const informationalGate: PublishGateCheck = () =>
  Promise.resolve(ok(undefined));

export interface LibraryDeps {
  readonly db: Db;
  /** Where a LibreChat agent without a usable model points (`models.default`). */
  readonly defaultModel?: ModelSelector | null;
  /** Seals MCP header secrets (D24). An error only stops new secrets being stored. */
  readonly keys: Result<KeyRing, CryptoError>;
  readonly now?: () => Date;
  readonly publishGate?: PublishGateCheck;
  /** The operator's `mcp.userServers` (184); omitted means any http/sse server. */
  readonly userServers?: UserServerPolicy;
}

export const isVersionedKind = (kind: LibraryKind): kind is VersionedKind =>
  kind === "agent" || kind === "prompt" || kind === "skill";

const toFact = (row: GrantRow): GrantFact => ({
  permission: row.permission,
  principal: { id: row.principalId, type: row.principalType } as Principal,
  resourceId: row.resourceId,
  resourceType: row.resourceType,
});

/** The caller, with the grants they hold on `ids` (or on every library item). */
export const loadCaller = async (
  db: Db,
  userId: UserId,
  ids?: readonly string[]
): Promise<Caller> => {
  const principals = await loadPrincipals(db, userId);
  const rows = ids
    ? await listGrantsForPrincipals(db, principals, { resourceIds: ids })
    : await libraryGrantsFor(db, principals);
  return {
    grants: rows
      .filter((row) => row.resourceType !== "conversation")
      .map(toFact),
    principals,
    userId,
  };
};

export interface Resolved extends FoundLibraryItem {
  readonly access: LibraryAccess;
  readonly caller: Caller;
}

/**
 * The item and the caller's access, or `not_found` when it doesn't exist
 * or the caller has no access at all (so ids don't leak). `need` above what
 * they have is `forbidden`: they know it exists.
 */
export const resolveItem = async (
  db: Db,
  userId: UserId,
  id: LibraryItemId,
  need: "use" | "view" | "edit" | "manage" = "use"
): AsyncResult<Resolved, LibraryError> => {
  const [found, caller] = await Promise.all([
    findLibraryItem(db, id),
    loadCaller(db, userId, [id]),
  ]);
  if (!found) {
    return err(notFound());
  }
  const access = libraryAccessOf(caller, found.kind, found.row);
  if (access === null) {
    return err(notFound());
  }
  if (!allows(access, need)) {
    return err({ type: "forbidden" });
  }
  return ok({ ...found, access, caller });
};

/** A version's definition as the contract has it (skills get their files back). */
export const versionDefinition = async (
  db: Db,
  kind: VersionedKind,
  itemId: LibraryItemId,
  versionId: LibraryVersionId
): Promise<
  | { readonly definition: LibraryDefinition; readonly row: VersionRowLike }
  | undefined
> => {
  const found = await getVersion(db, kind, versionId);
  if (!found.ok || found.value.itemId !== itemId) {
    return;
  }
  const row = found.value;
  if (kind === "skill") {
    const files = await listSkillFiles(db, versionId);
    return {
      definition: {
        ...(row.definition as LibraryDefinition & { kind: "skill" }),
        files: files.map((file) => ({
          fileId: file.fileId as never,
          path: file.path,
        })),
        kind: "skill",
      },
      row: row as VersionRowLike,
    };
  }
  return { definition: row.definition as LibraryDefinition, row };
};

/** An MCP server's or preset's definition (secrets stay sealed). */
export const unversionedDefinition = async (
  db: Db,
  kind: "mcp_server" | "preset",
  id: LibraryItemId
): Promise<LibraryDefinition | undefined> => {
  if (kind === "mcp_server") {
    const found = await getMcpServer(db, id);
    return found.ok
      ? mcpDefinitionView(
          found.value.definition,
          found.value.secretCiphertext !== null
        )
      : undefined;
  }
  const found = await getPreset(db, id);
  return found.ok ? found.value.definition : undefined;
};

/**
 * The definition consumers and viewers see: the latest published version,
 * or (for editors, before the first publish) the draft.
 */
export const currentDefinition = async (
  db: Db,
  item: FoundLibraryItem,
  canEdit: boolean
): Promise<
  | {
      readonly definition: LibraryDefinition;
      readonly versionId: LibraryVersionId | null;
    }
  | undefined
> => {
  const { kind, row } = item;
  if (!isVersionedKind(kind)) {
    const definition = await unversionedDefinition(db, kind, row.id);
    return definition ? { definition, versionId: null } : undefined;
  }
  const versionId =
    row.latestVersionId ?? (canEdit ? row.draftVersionId : null);
  if (!versionId) {
    return;
  }
  const loaded = await versionDefinition(db, kind, row.id, versionId);
  return loaded ? { definition: loaded.definition, versionId } : undefined;
};

/** Contract views of several items at once: one query for flags, one for maintainers. */
export const itemViews = async (
  db: Db,
  items: readonly (FoundLibraryItem & { readonly access: LibraryAccess })[],
  now: Date = new Date()
): Promise<LibraryItem[]> => {
  const refs = items.map(
    (item): ResourceRef =>
      ({ resourceId: item.row.id, resourceType: item.kind }) as ResourceRef
  );
  const [flags, users] = await Promise.all([
    sharingFlags(db, refs, now),
    userSummaries(
      db,
      items.flatMap((item) => item.row.maintainers)
    ),
  ]);
  const byId = new Map(users.map((row) => [row.id, toUserSummary(row)]));
  return items.map((item) =>
    toLibraryItem(item.kind, item.row, {
      access: item.access,
      flags,
      users: byId,
    })
  );
};

export const detailOf = async (
  db: Db,
  item: FoundLibraryItem & { readonly access: LibraryAccess },
  content: {
    readonly definition: LibraryDefinition | null;
    readonly versionId: LibraryVersionId | null;
  }
): Promise<LibraryItemDetail> => {
  const [view] = await itemViews(db, [item]);
  if (!view) {
    throw new Error("itemViews returned nothing for one item");
  }
  return { ...view, ...content };
};

/** Re-reads an item after a write and returns its detail at `revision`. */
export const freshDetail = async (
  db: Db,
  userId: UserId,
  id: LibraryItemId,
  revision: "draft" | "latest"
): AsyncResult<LibraryItemDetail, LibraryError> => {
  const resolved = await resolveItem(db, userId, id);
  if (!resolved.ok) {
    return resolved;
  }
  const item = resolved.value;
  const canEdit = allows(item.access, "edit");
  if (revision === "draft" && canEdit && isVersionedKind(item.kind)) {
    const draftId = item.row.draftVersionId;
    const loaded = draftId
      ? await versionDefinition(db, item.kind, item.row.id, draftId)
      : undefined;
    return ok(
      await detailOf(db, item, {
        definition: loaded?.definition ?? null,
        versionId: loaded ? draftId : null,
      })
    );
  }
  const current = await currentDefinition(db, item, canEdit);
  return ok(
    await detailOf(db, item, {
      definition: allows(item.access, "view")
        ? (current?.definition ?? null)
        : null,
      versionId: current?.versionId ?? item.row.latestVersionId,
    })
  );
};
