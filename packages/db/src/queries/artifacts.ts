import type {
  ArtifactId,
  ArtifactVersionId,
  ConversationId,
  MessageId,
} from "@workspace/contract/schemas/common";
import type {
  Artifact,
  ArtifactVersion,
} from "@workspace/contract/schemas/files";
import type { ArtifactKind } from "@workspace/contract/schemas/message-parts";
import { type AsyncResult, err, ok } from "@workspace/shared/result";
import { and, asc, eq, sql } from "drizzle-orm";

import type { Db } from "../client";
import { type NotFoundError, notFound } from "../errors";
import { artifact, artifactVersion } from "../schema/files";

// Artifacts (PLAN.md §8): a document, page or snippet a message created,
// with every edit kept as a numbered version for the before/after diff.
// These queries don't check access; callers check the conversation first.

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

export const getArtifact = async (
  db: Db,
  id: ArtifactId
): AsyncResult<ArtifactRow, NotFoundError> => {
  const [row] = await db.select().from(artifact).where(eq(artifact.id, id));
  return row ? ok(row) : err(notFound("artifact", id));
};

/** A conversation's artifacts, oldest first. */
export const listArtifacts = (
  db: Db,
  conversationId: ConversationId
): Promise<ArtifactRow[]> =>
  db
    .select()
    .from(artifact)
    .where(eq(artifact.conversationId, conversationId))
    .orderBy(asc(artifact.createdAt), asc(artifact.id));

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
      [target] = await tx
        .select()
        .from(artifact)
        .where(
          and(
            eq(artifact.id, input.artifactId),
            eq(artifact.conversationId, input.conversationId)
          )
        )
        .for("update");
      if (!target) {
        return err(notFound("artifact", input.artifactId));
      }
    } else {
      [target] = await tx
        .insert(artifact)
        .values({
          conversationId: input.conversationId,
          kind: input.kind,
          messageId: input.messageId,
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
  title: row.title,
  updatedAt: row.updatedAt.toISOString(),
});

export const toArtifactVersion = (
  row: ArtifactVersionRow
): ArtifactVersion => ({
  artifactId: row.artifactId,
  content: row.content,
  createdAt: row.createdAt.toISOString(),
  id: row.id,
  language: row.language,
  messageId: row.messageId,
  number: row.number,
});
