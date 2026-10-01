import type {
  ArtifactId,
  ArtifactVersionId,
  ConversationId,
  GrantId,
  MessageId,
  UserId,
} from "@workspace/contract/schemas/common";
import type {
  Artifact,
  ArtifactAccess,
  ArtifactGrant,
  ArtifactPermission,
  ArtifactScope,
  ArtifactVersion,
} from "@workspace/contract/schemas/files";
import type { ArtifactKind } from "@workspace/contract/schemas/message-parts";
import type { Principal } from "@workspace/contract/schemas/tenancy";
import { type AsyncResult, err, ok } from "@workspace/shared/result";
import {
  and,
  asc,
  desc,
  eq,
  exists,
  ilike,
  inArray,
  lt,
  or,
  type SQL,
  sql,
} from "drizzle-orm";

import type { Db } from "../client";
import { type NotFoundError, notFound } from "../errors";
import { user } from "../schema/auth";
import { conversation, message } from "../schema/chat";
import {
  artifact,
  artifactGrant,
  artifactPublication,
  artifactUse,
  artifactVersion,
  artifactView,
} from "../schema/files";
import { type CursorKey, type Page, toPage } from "./page";

// Artifacts (PLAN.md §8): a document, page or snippet a message created,
// with every edit kept as a numbered version for the before/after diff.
// Since 124 an artifact is owned by a person (its chat's owner) and shared
// through `artifact_grant`; it can also be used in other chats
// (`artifact_use`). These queries don't check access; callers do.

export type ArtifactRow = typeof artifact.$inferSelect;
export type ArtifactVersionRow = typeof artifactVersion.$inferSelect;

/** An artifact with a version. Every artifact has one once written; deleting its versions leaves `null`. */
export type PublishedArtifactRow = ArtifactRow & {
  readonly latestVersionId: ArtifactVersionId;
};

export const hasVersion = (row: ArtifactRow): row is PublishedArtifactRow =>
  row.latestVersionId !== null;

// `latestVersionId` is nullable in the contract (042): an artifact whose
// versions are gone is still listed, with `null`, rather than vanishing
// while a message's artifact-ref still points at it.

export type ArtifactGrantRow = typeof artifactGrant.$inferSelect;

export const getArtifact = async (
  db: Db,
  id: ArtifactId
): AsyncResult<ArtifactRow, NotFoundError> => {
  const [row] = await db.select().from(artifact).where(eq(artifact.id, id));
  return row ? ok(row) : err(notFound("artifact", id));
};

/** A conversation's own artifacts, oldest first. */
export const listArtifacts = (
  db: Db,
  conversationId: ConversationId
): Promise<ArtifactRow[]> =>
  db
    .select()
    .from(artifact)
    .where(eq(artifact.conversationId, conversationId))
    .orderBy(asc(artifact.createdAt), asc(artifact.id));

/**
 * The artifacts a chat can reach: its own, oldest first, then those used in
 * it from elsewhere ("Use in chat"), in the order they were added.
 */
export const listChatArtifacts = async (
  db: Db,
  conversationId: ConversationId
): Promise<ArtifactRow[]> => {
  const [own, used] = await Promise.all([
    listArtifacts(db, conversationId),
    listUsedArtifacts(db, conversationId),
  ]);
  const ids = new Set(own.map((row) => row.id));
  return [...own, ...used.filter((row) => !ids.has(row.id))];
};

/** Artifacts used in a chat other than their own, in the order they were added. */
export const listUsedArtifacts = async (
  db: Db,
  conversationId: ConversationId
): Promise<ArtifactRow[]> => {
  const rows = await db
    .select({ artifact })
    .from(artifactUse)
    .innerJoin(artifact, eq(artifact.id, artifactUse.artifactId))
    .where(eq(artifactUse.conversationId, conversationId))
    .orderBy(asc(artifactUse.createdAt), asc(artifact.id));
  return rows.map((row) => row.artifact);
};

/** The chats an artifact was used in, besides its own. */
export const listArtifactUses = async (
  db: Db,
  artifactId: ArtifactId
): Promise<ConversationId[]> => {
  const rows = await db
    .select({ conversationId: artifactUse.conversationId })
    .from(artifactUse)
    .where(eq(artifactUse.artifactId, artifactId));
  return rows.map((row) => row.conversationId);
};

/** "Use in chat": attaches the artifact to a chat. Using it twice is a no-op. */
export const attachArtifactToChat = async (
  db: Db,
  input: {
    readonly addedBy: UserId;
    readonly artifactId: ArtifactId;
    readonly conversationId: ConversationId;
  }
): Promise<void> => {
  await db.insert(artifactUse).values(input).onConflictDoNothing();
};

/** Every version of an artifact, oldest first. */
export const listArtifactVersions = (
  db: Db,
  artifactId: ArtifactId
): Promise<ArtifactVersionRow[]> =>
  db
    .select()
    .from(artifactVersion)
    .where(eq(artifactVersion.artifactId, artifactId))
    .orderBy(asc(artifactVersion.number));

/** One version, only if it belongs to `artifactId`. */
export const getArtifactVersion = async (
  db: Db,
  artifactId: ArtifactId,
  versionId: ArtifactVersionId
): AsyncResult<ArtifactVersionRow, NotFoundError> => {
  const [row] = await db
    .select()
    .from(artifactVersion)
    .where(
      and(
        eq(artifactVersion.id, versionId),
        eq(artifactVersion.artifactId, artifactId)
      )
    );
  return row ? ok(row) : err(notFound("artifact_version", versionId));
};

export interface NewArtifactVersion {
  /** Omit to create a new artifact; pass one to add a version to it. */
  readonly artifactId?: ArtifactId;
  readonly content: string;
  readonly conversationId: ConversationId;
  readonly kind: ArtifactKind;
  readonly language?: string | null;
  /** The message that produced this version. */
  readonly messageId: MessageId;
  /**
   * Who owns a new artifact; its chat's owner when left out (124), as for
   * what a chat's model makes. "Save as artifact" (125) passes the person.
   */
  readonly ownerId?: UserId;
  readonly title: string;
}

/**
 * Writes the next version of an artifact (creating the artifact for its
 * first) and points `latestVersionId` at it, in one transaction. The
 * artifact row is locked so two writers can't take the same number.
 */
export const saveArtifactVersion = (
  db: Db,
  input: NewArtifactVersion
): AsyncResult<
  {
    readonly artifact: PublishedArtifactRow;
    readonly version: ArtifactVersionRow;
  },
  NotFoundError
> =>
  db.transaction(async (tx) => {
    let target: ArtifactRow | undefined;
    if (input.artifactId) {
      // Its own chat, or one it was used in (124).
      [target] = await tx
        .select()
        .from(artifact)
        .where(
          and(
            eq(artifact.id, input.artifactId),
            or(
              eq(artifact.conversationId, input.conversationId),
              exists(
                tx
                  .select({ one: sql`1` })
                  .from(artifactUse)
                  .where(
                    and(
                      eq(artifactUse.artifactId, artifact.id),
                      eq(artifactUse.conversationId, input.conversationId)
                    )
                  )
              )
            )
          )
        )
        .for("update", { of: artifact });
      if (!target) {
        return err(notFound("artifact", input.artifactId));
      }
    } else {
      // A new artifact belongs to its chat's owner (124).
      const [chat] = await tx
        .select({ ownerId: conversation.ownerId })
        .from(conversation)
        .where(eq(conversation.id, input.conversationId));
      if (!chat) {
        return err(notFound("conversation", input.conversationId));
      }
      [target] = await tx
        .insert(artifact)
        .values({
          conversationId: input.conversationId,
          kind: input.kind,
          messageId: input.messageId,
          ownerId: input.ownerId ?? chat.ownerId,
          title: input.title,
        })
        .returning();
    }
    if (!target) {
      throw new Error("insert returned no row");
    }
    const [{ next } = { next: 1 }] = await tx
      .select({
        next: sql<number>`coalesce(max(${artifactVersion.number}), 0) + 1`.mapWith(
          Number
        ),
      })
      .from(artifactVersion)
      .where(eq(artifactVersion.artifactId, target.id));
    const [version] = await tx
      .insert(artifactVersion)
      .values({
        artifactId: target.id,
        content: input.content,
        conversationId: input.conversationId,
        language: input.language ?? null,
        messageId: input.messageId,
        number: next,
      })
      .returning();
    if (!version) {
      throw new Error("insert returned no row");
    }
    const [updated] = await tx
      .update(artifact)
      .set({ latestVersionId: version.id, title: input.title })
      .where(eq(artifact.id, target.id))
      .returning();
    if (!(updated && hasVersion(updated))) {
      throw new Error("update returned no row");
    }
    return ok({ artifact: updated, version });
  });

export const toArtifact = (row: ArtifactRow): Artifact => ({
  conversationId: row.conversationId,
  createdAt: row.createdAt.toISOString(),
  id: row.id,
  kind: row.kind,
  latestVersionId: row.latestVersionId,
  messageId: row.messageId,
  ownerId: row.ownerId,
  title: row.title,
  updatedAt: row.updatedAt.toISOString(),
});

export const toArtifactVersion = (
  row: ArtifactVersionRow
): ArtifactVersion => ({
  artifactId: row.artifactId,
  content: row.content,
  conversationId: row.conversationId,
  createdAt: row.createdAt.toISOString(),
  id: row.id,
  language: row.language,
  messageId: row.messageId,
  number: row.number,
});

// --- The Artifacts page (124) ---

/** Grants on `artifact.id` held by any of `principals`, as one condition. */
const grantHeldBy = (principals: readonly Principal[], level?: SQL): SQL => {
  const held =
    principals.length === 0
      ? sql`false`
      : (or(
          ...principals.map((principal) =>
            and(
              eq(artifactGrant.principalType, principal.type),
              eq(artifactGrant.principalId, principal.id)
            )
          )
        ) ?? sql`false`);
  // Conditions, not bare columns: a bare column in a select's `sql` is
  // rendered unqualified, and `id` would then mean the grant's own.
  return sql`exists (select 1 from ${artifactGrant} where ${and(eq(artifactGrant.artifactId, artifact.id), held, level)})`;
};

/** Whether anyone holds a share on `artifact.id`. */
const anyGrant = (): SQL =>
  sql`exists (select 1 from ${artifactGrant} where ${eq(artifactGrant.artifactId, artifact.id)})`;

/**
 * The caller's access from ownership and grants: `owner`, the strongest
 * grant (`editor` over `viewer`), or `null` with neither. Access through a
 * chat (reading the chat it was made or used in) is the caller's to add.
 */
export const artifactAccessOf = async (
  db: Db,
  id: ArtifactId,
  actor: { readonly principals: readonly Principal[]; readonly userId: UserId }
): Promise<ArtifactAccess | null> => {
  const [row] = await db
    .select({
      editor: grantHeldBy(
        actor.principals,
        eq(artifactGrant.permission, "editor")
      ).mapWith(Boolean),
      ownerId: artifact.ownerId,
      viewer: grantHeldBy(actor.principals).mapWith(Boolean),
    })
    .from(artifact)
    .where(eq(artifact.id, id));
  if (!row) {
    return null;
  }
  if (row.ownerId === actor.userId) {
    return "owner";
  }
  if (row.editor) {
    return "editor";
  }
  return row.viewer ? "viewer" : null;
};

/** One row of the page, before the caller's chat access is known. */
export interface ArtifactPageRow {
  readonly access: ArtifactAccess;
  readonly artifact: ArtifactRow;
  readonly ownerName: string;
  readonly shared: boolean;
  readonly viewedAt: Date | null;
}

export interface ArtifactPageFilter {
  readonly actor: {
    readonly principals: readonly Principal[];
    readonly userId: UserId;
  };
  /** The last row of the previous page (`decodeCursor`). */
  readonly after?: CursorKey;
  readonly kind?: ArtifactKind;
  readonly limit: number;
  /** Case-insensitive, on the title and the latest version's content. */
  readonly query?: string;
  readonly scope: ArtifactScope;
}

const LIKE_SPECIAL = /[\\%_]/g;

/**
 * The Artifacts page: what the caller owns and what's shared with them,
 * most recently viewed by them first (an artifact they never opened sorts
 * by its last change), keyset-paged on that time and the id.
 */
export const listArtifactPage = async (
  db: Db,
  filter: ArtifactPageFilter
): Promise<Page<ArtifactPageRow>> => {
  const { actor } = filter;
  const mine = eq(artifact.ownerId, actor.userId);
  const sharedWithMe = grantHeldBy(actor.principals);
  const scope = {
    all: or(mine, sharedWithMe),
    mine,
    shared: and(sql`${artifact.ownerId} <> ${actor.userId}`, sharedWithMe),
  }[filter.scope];
  // Spelled out: in a select, bare columns in `sql` lose their table, and
  // `updated_at` is on the owner's row too.
  const sortKey = sql<Date>`coalesce(${sql.raw('"artifact_view"."viewed_at"')}, ${sql.raw('"artifact"."updated_at"')})`;
  const pattern = filter.query
    ? `%${filter.query.replace(LIKE_SPECIAL, (c) => `\\${c}`)}%`
    : undefined;
  const { after } = filter;
  const rows = await db
    .select({
      artifact,
      editor: grantHeldBy(
        actor.principals,
        eq(artifactGrant.permission, "editor")
      ).mapWith(Boolean),
      ownerName: user.name,
      shared: anyGrant().mapWith(Boolean),
      sortKey: sortKey.mapWith((value: string | Date) => new Date(value)),
      viewedAt: artifactView.viewedAt,
    })
    .from(artifact)
    .innerJoin(user, eq(user.id, artifact.ownerId))
    .leftJoin(
      artifactView,
      and(
        eq(artifactView.artifactId, artifact.id),
        eq(artifactView.userId, actor.userId)
      )
    )
    .leftJoin(artifactVersion, eq(artifactVersion.id, artifact.latestVersionId))
    .where(
      and(
        scope,
        filter.kind ? eq(artifact.kind, filter.kind) : undefined,
        pattern
          ? or(
              ilike(artifact.title, pattern),
              ilike(artifactVersion.content, pattern)
            )
          : undefined,
        after
          ? or(
              sql`${sortKey} < ${String(after.key)}::timestamptz`,
              and(
                sql`${sortKey} = ${String(after.key)}::timestamptz`,
                lt(artifact.id, after.id as ArtifactId)
              )
            )
          : undefined
      )
    )
    .orderBy(desc(sortKey), desc(artifact.id))
    .limit(filter.limit + 1);
  const page = toPage(rows, filter.limit, (row) => ({
    id: row.artifact.id,
    key: row.sortKey.toISOString(),
  }));
  return {
    items: page.items.map(
      (row): ArtifactPageRow => ({
        access: (() => {
          if (row.artifact.ownerId === actor.userId) {
            return "owner";
          }
          return row.editor ? "editor" : "viewer";
        })(),
        artifact: row.artifact,
        ownerName: row.ownerName,
        shared: row.shared,
        viewedAt: row.viewedAt,
      })
    ),
    nextCursor: page.nextCursor,
  };
};

/** The page's facts for one artifact the caller can reach some other way. */
export const artifactPageFacts = async (
  db: Db,
  id: ArtifactId,
  userId: UserId
): Promise<{
  readonly ownerName: string;
  readonly shared: boolean;
  readonly viewedAt: Date | null;
} | null> => {
  const [row] = await db
    .select({
      ownerName: user.name,
      shared: anyGrant().mapWith(Boolean),
      viewedAt: artifactView.viewedAt,
    })
    .from(artifact)
    .innerJoin(user, eq(user.id, artifact.ownerId))
    .leftJoin(
      artifactView,
      and(
        eq(artifactView.artifactId, artifact.id),
        eq(artifactView.userId, userId)
      )
    )
    .where(eq(artifact.id, id));
  return row ?? null;
};

export const renameArtifact = async (
  db: Db,
  id: ArtifactId,
  title: string
): AsyncResult<ArtifactRow, NotFoundError> => {
  const [row] = await db
    .update(artifact)
    .set({ title })
    .where(eq(artifact.id, id))
    .returning();
  return row ? ok(row) : err(notFound("artifact", id));
};

/** Deletes it with its versions, shares, views and uses (foreign keys cascade). */
export const deleteArtifact = async (
  db: Db,
  id: ArtifactId
): Promise<boolean> => {
  const deleted = await db
    .delete(artifact)
    .where(eq(artifact.id, id))
    .returning({ id: artifact.id });
  return deleted.length > 0;
};

/**
 * A copy of the latest version as a new artifact `ownerId` owns, unshared.
 * It keeps the source's chat and message, so "Go to chat" leads where the
 * content came from (for those who can open it).
 */
export const duplicateArtifact = (
  db: Db,
  id: ArtifactId,
  ownerId: UserId,
  title: string
): AsyncResult<ArtifactRow, NotFoundError> =>
  db.transaction(async (tx) => {
    const [source] = await tx
      .select({ artifact, version: artifactVersion })
      .from(artifact)
      .innerJoin(
        artifactVersion,
        eq(artifactVersion.id, artifact.latestVersionId)
      )
      .where(eq(artifact.id, id));
    if (!source) {
      return err(notFound("artifact", id));
    }
    const [copy] = await tx
      .insert(artifact)
      .values({
        conversationId: source.artifact.conversationId,
        kind: source.artifact.kind,
        messageId: source.artifact.messageId,
        ownerId,
        title,
      })
      .returning();
    if (!copy) {
      throw new Error("insert returned no row");
    }
    const [version] = await tx
      .insert(artifactVersion)
      .values({
        artifactId: copy.id,
        content: source.version.content,
        conversationId: source.version.conversationId,
        language: source.version.language,
        messageId: source.version.messageId,
        number: 1,
      })
      .returning();
    if (!version) {
      throw new Error("insert returned no row");
    }
    const [updated] = await tx
      .update(artifact)
      .set({ latestVersionId: version.id })
      .where(eq(artifact.id, copy.id))
      .returning();
    if (!updated) {
      throw new Error("update returned no row");
    }
    return ok(updated);
  });

/** Records that `userId` opened the artifact at `at`. */
export const markArtifactViewed = async (
  db: Db,
  artifactId: ArtifactId,
  userId: UserId,
  at: Date = new Date()
): Promise<void> => {
  await db
    .insert(artifactView)
    .values({ artifactId, userId, viewedAt: at })
    .onConflictDoUpdate({
      set: { viewedAt: at },
      target: [artifactView.artifactId, artifactView.userId],
    });
};

/** An artifact's shares, oldest first. */
export const listArtifactGrants = (
  db: Db,
  artifactId: ArtifactId
): Promise<ArtifactGrantRow[]> =>
  db
    .select()
    .from(artifactGrant)
    .where(eq(artifactGrant.artifactId, artifactId))
    .orderBy(asc(artifactGrant.createdAt), asc(artifactGrant.id));

/** Shares with a principal; sharing again replaces the level. */
export const upsertArtifactGrant = async (
  db: Db,
  input: {
    readonly artifactId: ArtifactId;
    readonly grantedBy: UserId;
    readonly permission: ArtifactPermission;
    readonly principal: Principal;
  }
): Promise<ArtifactGrantRow> => {
  const [row] = await db
    .insert(artifactGrant)
    .values({
      artifactId: input.artifactId,
      grantedBy: input.grantedBy,
      permission: input.permission,
      principalId: input.principal.id,
      principalType: input.principal.type,
    })
    .onConflictDoUpdate({
      set: {
        grantedBy: input.grantedBy,
        permission: input.permission,
        updatedAt: new Date(),
      },
      target: [
        artifactGrant.artifactId,
        artifactGrant.principalType,
        artifactGrant.principalId,
      ],
    })
    .returning();
  if (!row) {
    throw new Error("upsert returned no row");
  }
  return row;
};

/** One share, only if it's on `artifactId`. */
export const getArtifactGrant = async (
  db: Db,
  artifactId: ArtifactId,
  id: GrantId
): AsyncResult<ArtifactGrantRow, NotFoundError> => {
  const [row] = await db
    .select()
    .from(artifactGrant)
    .where(
      and(eq(artifactGrant.id, id), eq(artifactGrant.artifactId, artifactId))
    );
  return row ? ok(row) : err(notFound("artifact_grant", id));
};

export const deleteArtifactGrant = async (
  db: Db,
  id: GrantId
): Promise<void> => {
  await db.delete(artifactGrant).where(eq(artifactGrant.id, id));
};

export const toArtifactGrant = (row: ArtifactGrantRow): ArtifactGrant => ({
  createdAt: row.createdAt.toISOString(),
  grantedBy: row.grantedBy,
  id: row.id,
  permission: row.permission,
  principal: { id: row.principalId, type: row.principalType } as Principal,
});

/** Which of `ids` are owned by `userId`, for the cheap half of "Go to chat". */
export const conversationOwners = async (
  db: Db,
  ids: readonly ConversationId[]
): Promise<ReadonlyMap<ConversationId, UserId>> => {
  if (ids.length === 0) {
    return new Map();
  }
  const rows = await db
    .select({ id: conversation.id, ownerId: conversation.ownerId })
    .from(conversation)
    .where(inArray(conversation.id, [...new Set(ids)]));
  return new Map(rows.map((row) => [row.id, row.ownerId]));
};

// Publishing (125): one public link per artifact, serving one version.

export type ArtifactPublicationRow = typeof artifactPublication.$inferSelect;

export const getArtifactPublication = async (
  db: Db,
  artifactId: ArtifactId
): Promise<ArtifactPublicationRow | null> => {
  const [row] = await db
    .select()
    .from(artifactPublication)
    .where(eq(artifactPublication.artifactId, artifactId));
  return row ?? null;
};

/**
 * Publishes `versionId`. Publishing again moves the link to it and keeps
 * the token, so the URL people have keeps working.
 */
export const publishArtifactVersion = async (
  db: Db,
  input: {
    readonly artifactId: ArtifactId;
    readonly publishedBy: UserId;
    readonly token: string;
    readonly versionId: ArtifactVersionId;
  },
  at: Date = new Date()
): Promise<ArtifactPublicationRow> => {
  const [row] = await db
    .insert(artifactPublication)
    .values({ ...input, publishedAt: at })
    .onConflictDoUpdate({
      set: {
        publishedAt: at,
        publishedBy: input.publishedBy,
        versionId: input.versionId,
      },
      target: artifactPublication.artifactId,
    })
    .returning();
  if (!row) {
    throw new Error("upsert returned no row");
  }
  return row;
};

/** Takes the link down; publishing again makes a new token. */
export const unpublishArtifact = async (
  db: Db,
  artifactId: ArtifactId
): Promise<void> => {
  await db
    .delete(artifactPublication)
    .where(eq(artifactPublication.artifactId, artifactId));
};

/** What a published link serves, by its token; `null` for an unknown one. */
export const getPublishedArtifact = async (
  db: Db,
  token: string
): Promise<{
  readonly content: string;
  readonly kind: ArtifactKind;
  readonly publishedAt: Date;
  readonly title: string;
} | null> => {
  const [row] = await db
    .select({
      content: artifactVersion.content,
      kind: artifact.kind,
      publishedAt: artifactPublication.publishedAt,
      title: artifact.title,
    })
    .from(artifactPublication)
    .innerJoin(artifact, eq(artifact.id, artifactPublication.artifactId))
    .innerJoin(
      artifactVersion,
      eq(artifactVersion.id, artifactPublication.versionId)
    )
    .where(eq(artifactPublication.token, token));
  return row ?? null;
};

/**
 * The chat's newest message, which a version saved outside a run ("Save
 * as artifact", 125) records as the one it came from; `null` in an empty
 * chat.
 */
export const newestMessageIn = async (
  db: Db,
  conversationId: ConversationId
): Promise<MessageId | null> => {
  const [row] = await db
    .select({ id: message.id })
    .from(message)
    .where(eq(message.conversationId, conversationId))
    .orderBy(desc(message.createdAt), desc(message.id))
    .limit(1);
  return row?.id ?? null;
};
