import type {
  MemoryVersionId,
  UserId,
} from "@workspace/contract/schemas/common";
import type {
  MemoryMode,
  MemoryVersion,
  memoryVersionSourceSchema,
} from "@workspace/contract/schemas/memory";
import { type AsyncResult, err, ok } from "@workspace/shared/result";
import { and, desc, eq, lt, max } from "drizzle-orm";
import type { z } from "zod";

import type { Db } from "../client";
import {
  type ConflictError,
  conflict,
  type NotFoundError,
  notFound,
} from "../errors";
import { memory, memoryVersion } from "../schema/memory";

// Memory (D20): one Markdown file per user. Every write is a new version,
// so undo is a revert to an earlier one and nothing is ever lost.

export type MemoryRow = typeof memory.$inferSelect;
export type MemoryVersionRow = typeof memoryVersion.$inferSelect;
type MemorySource = z.infer<typeof memoryVersionSourceSchema>;

/** The user's memory, or the empty default before their first write. */
export const getMemory = async (db: Db, userId: UserId): Promise<MemoryRow> => {
  const [row] = await db.select().from(memory).where(eq(memory.userId, userId));
  return (
    row ?? {
      content: "",
      currentVersionId: null,
      mode: "auto",
      updatedAt: new Date(0),
      userId,
    }
  );
};

export interface MemoryWrite {
  /**
   * The version the edit was based on (`null`: the empty file). A stale base
   * is a `version_mismatch` conflict; omit it to write unconditionally (the
   * agent's `update_memory`, which applies patches to the current content).
   */
  readonly baseVersionId?: MemoryVersionId | null;
  readonly content: string;
  readonly source: MemorySource;
  readonly userId: UserId;
}

/** Writes a new version and makes it current. The memory row is locked, so numbers never collide. */
export const writeMemory = (
  db: Db,
  input: MemoryWrite
): AsyncResult<MemoryVersionRow, ConflictError> =>
  db.transaction(async (tx) => {
    await tx
      .insert(memory)
      .values({ userId: input.userId })
      .onConflictDoNothing({ target: memory.userId });
    const [current] = await tx
      .select()
      .from(memory)
      .where(eq(memory.userId, input.userId))
      .for("update");
    if (
      input.baseVersionId !== undefined &&
      input.baseVersionId !== (current?.currentVersionId ?? null)
    ) {
      return err(conflict("version_mismatch"));
    }
    const [top] = await tx
      .select({ number: max(memoryVersion.number) })
      .from(memoryVersion)
      .where(eq(memoryVersion.userId, input.userId));
    const [version] = await tx
      .insert(memoryVersion)
      .values({
        content: input.content,
        number: (top?.number ?? 0) + 1,
        source: input.source,
        userId: input.userId,
      })
      .returning();
    if (!version) {
      throw new Error("insert returned no row");
    }
    await tx
      .update(memory)
      .set({ content: input.content, currentVersionId: version.id })
      .where(eq(memory.userId, input.userId));
    return ok(version);
  });

/** Undo: a new version with the content of `versionId`. */
export const revertMemory = async (
  db: Db,
  userId: UserId,
  versionId: MemoryVersionId
): AsyncResult<MemoryVersionRow, NotFoundError | ConflictError> => {
  const [target] = await db
    .select()
    .from(memoryVersion)
    .where(
      and(eq(memoryVersion.id, versionId), eq(memoryVersion.userId, userId))
    );
  if (!target) {
    return err(notFound("memory_version", versionId));
  }
  return writeMemory(db, {
    content: target.content,
    source: { fromVersionId: versionId, type: "revert" },
    userId,
  });
};

export const setMemoryMode = async (
  db: Db,
  userId: UserId,
  mode: MemoryMode
): Promise<MemoryRow> => {
  const [row] = await db
    .insert(memory)
    .values({ mode, userId })
    .onConflictDoUpdate({ set: { mode }, target: memory.userId })
    .returning();
  if (!row) {
    throw new Error("upsert returned no row");
  }
  return row;
};

/** Versions newest first; `before` is the number to page back from. */
export const listMemoryVersions = (
  db: Db,
  userId: UserId,
  {
    before,
    limit = 50,
  }: { readonly before?: number; readonly limit?: number } = {}
): Promise<MemoryVersionRow[]> =>
  db
    .select()
    .from(memoryVersion)
    .where(
      and(
        eq(memoryVersion.userId, userId),
        before === undefined ? undefined : lt(memoryVersion.number, before)
      )
    )
    .orderBy(desc(memoryVersion.number))
    .limit(limit);

export const toMemoryVersion = (row: MemoryVersionRow): MemoryVersion => ({
  content: row.content,
  createdAt: row.createdAt.toISOString(),
  id: row.id,
  number: row.number,
  source: row.source,
});
