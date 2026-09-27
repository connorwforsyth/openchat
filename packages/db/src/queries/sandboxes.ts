import type {
  ConversationId,
  SandboxId,
} from "@workspace/contract/schemas/common";
import type {
  SandboxLimits,
  SandboxProvider,
  SandboxRecord,
  SandboxStatus,
  sandboxIsolationSchema,
} from "@workspace/contract/schemas/sandbox";
import { eq } from "drizzle-orm";
import type { z } from "zod";

import type { Db } from "../client";
import { sandbox } from "../schema/sandbox";

// Sandboxes (D7): at most one per conversation. Access is the
// conversation's; callers check it (`getConversation`) before these run.

export type SandboxRow = typeof sandbox.$inferSelect;

export interface NewSandbox {
  readonly conversationId: ConversationId;
  readonly externalId?: string | null;
  readonly id?: SandboxId;
  readonly isolation: z.infer<typeof sandboxIsolationSchema>;
  readonly limits: SandboxLimits;
  readonly provider: SandboxProvider;
  readonly snapshotRef?: string | null;
  readonly status: SandboxStatus;
}

const stateColumns = (status: SandboxStatus) => ({
  state: status.state,
  stateMessage: status.state === "failed" ? status.message : null,
});

/** The row as the contract's `Sandbox`. */
export const toSandboxRecord = (row: SandboxRow): SandboxRecord => ({
  conversationId: row.conversationId,
  createdAt: row.createdAt.toISOString(),
  id: row.id,
  isolation: row.isolation,
  limits: row.limits,
  previews: row.previews,
  provider: row.provider,
  snapshotRef: row.snapshotRef,
  status:
    row.state === "failed"
      ? { message: row.stateMessage ?? "", state: "failed" }
      : { state: row.state },
  updatedAt: row.updatedAt.toISOString(),
});

/** Inserts the conversation's sandbox; `null` if it already has one. */
export const insertSandbox = async (
  db: Db,
  input: NewSandbox
): Promise<SandboxRow | null> => {
  const [row] = await db
    .insert(sandbox)
    .values({
      conversationId: input.conversationId,
      externalId: input.externalId ?? null,
      ...(input.id ? { id: input.id } : {}),
      isolation: input.isolation,
      limits: input.limits,
      provider: input.provider,
      snapshotRef: input.snapshotRef ?? null,
      ...stateColumns(input.status),
    })
    .onConflictDoNothing({ target: sandbox.conversationId })
    .returning();
  return row ?? null;
};

export const getSandbox = async (
  db: Db,
  id: SandboxId
): Promise<SandboxRow | null> => {
  const [row] = await db.select().from(sandbox).where(eq(sandbox.id, id));
  return row ?? null;
};

export const getSandboxForConversation = async (
  db: Db,
  conversationId: ConversationId
): Promise<SandboxRow | null> => {
  const [row] = await db
    .select()
    .from(sandbox)
    .where(eq(sandbox.conversationId, conversationId));
  return row ?? null;
};

export interface SandboxPatch {
  readonly isolation?: z.infer<typeof sandboxIsolationSchema>;
  readonly previews?: readonly {
    readonly port: number;
    readonly url: string;
  }[];
  readonly snapshotRef?: string | null;
  readonly status?: SandboxStatus;
}

/** Updates a sandbox; `null` if it's gone. */
export const updateSandbox = async (
  db: Db,
  id: SandboxId,
  patch: SandboxPatch
): Promise<SandboxRow | null> => {
  const [row] = await db
    .update(sandbox)
    .set({
      ...(patch.isolation ? { isolation: patch.isolation } : {}),
      ...(patch.previews
        ? { previews: patch.previews.map((preview) => ({ ...preview })) }
        : {}),
      ...(patch.snapshotRef === undefined
        ? {}
        : { snapshotRef: patch.snapshotRef }),
      ...(patch.status ? stateColumns(patch.status) : {}),
      updatedAt: new Date(),
    })
    .where(eq(sandbox.id, id))
    .returning();
  return row ?? null;
};

/** Deletes the row; the provider's sandbox is destroyed by the caller first. */
export const deleteSandbox = async (
  db: Db,
  id: SandboxId
): Promise<boolean> => {
  const deleted = await db
    .delete(sandbox)
    .where(eq(sandbox.id, id))
    .returning({ id: sandbox.id });
  return deleted.length > 0;
};
