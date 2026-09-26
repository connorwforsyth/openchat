import type {
  ConversationId,
  MessageId,
  UserId,
} from "@workspace/contract/schemas/common";
import type { Db } from "@workspace/db/client";
import type { StoredContext } from "@workspace/db/queries/conversations";
import {
  conversation,
  conversationParticipant,
  message,
} from "@workspace/db/schema/chat";
import { newId } from "@workspace/shared/ids";
import {
  type AsyncResult,
  err,
  ok,
  type Result,
} from "@workspace/shared/result";
import { sql } from "drizzle-orm";

import {
  type ConversationFailure,
  describeIssues,
  type ImportedConversation,
  importedConversationSchema,
} from "./schema";
import { checkTree } from "./tree";

// Writes imported conversations (PLAN.md D1, §8). Each conversation belongs
// to the importing user, in the chat context they chose, and is personal by
// default: no grants are written (D17, D25). Ids are fresh UUIDv7s; parent
// links and timestamps come from the export.
//
// Each conversation is its own transaction, so it lands whole or not at all,
// and a long import neither holds one transaction open for minutes nor loses
// everything to one bad conversation.

/** Rows per insert: well under Postgres's 65,535 bind parameters. */
const BATCH = 500;

export interface ImportedSummary {
  readonly conversationId: ConversationId;
  /** Position in the import, from 0. */
  readonly index: number;
  readonly messageCount: number;
  readonly sourceId: string | null;
}

export interface ImportResult {
  readonly failures: readonly ConversationFailure[];
  readonly imported: readonly ImportedSummary[];
  readonly messageCount: number;
}

/** Nothing was imported, though there was something to import. */
export interface NothingImportedError {
  readonly failures: readonly ConversationFailure[];
  readonly type: "nothing_imported";
}

/** A parsed conversation, or a parser's result for one (`parseExport`, `parseExportStream`). */
export type ImportInput =
  | ImportedConversation
  | Result<ImportedConversation, ConversationFailure>;

const unwrap = (
  input: ImportInput,
  index: number
): Result<ImportedConversation, ConversationFailure> => {
  if ("ok" in input && typeof input.ok === "boolean") {
    return input;
  }
  const parsed = importedConversationSchema.safeParse(input);
  if (!parsed.success) {
    return err({
      detail: describeIssues(parsed.error),
      index,
      reason: "invalid_shape",
      sourceId: null,
    });
  }
  return { ok: true, value: parsed.data };
};

const writeConversation = (
  db: Db,
  ownerId: UserId,
  context: StoredContext,
  imported: ImportedConversation
): Promise<ConversationId> =>
  db.transaction(async (tx) => {
    const ids = new Map<string, MessageId>(
      imported.messages.map((m) => [m.sourceId, newId("message")])
    );
    const lastMessageAt = imported.messages.reduce(
      (latest, m) => Math.max(latest, Date.parse(m.createdAt)),
      Date.parse(imported.createdAt)
    );
    const [row] = await tx
      .insert(conversation)
      .values({
        contextId: context.id,
        // Imported history has messages, so the context is fixed from the start (D17).
        contextLockedAt: sql`now()`,
        contextType: context.type,
        createdAt: new Date(imported.createdAt),
        lastMessageAt: new Date(lastMessageAt),
        ownerId,
        title: imported.title,
      })
      .returning({ id: conversation.id });
    if (!row) {
      throw new Error("insert returned no row");
    }
    const leaf =
      imported.activeLeafSourceId === null
        ? undefined
        : ids.get(imported.activeLeafSourceId);
    // `messages` lists parents first, so each batch's parents are already written.
    for (let i = 0; i < imported.messages.length; i += BATCH) {
      // biome-ignore lint/performance/noAwaitInLoops: batches run in order, so each one's parents are already written.
      await tx.insert(message).values(
        imported.messages.slice(i, i + BATCH).map((m) => ({
          authorId: m.role === "user" ? ownerId : null,
          conversationId: row.id,
          createdAt: new Date(m.createdAt),
          id: ids.get(m.sourceId) as MessageId,
          model: m.model,
          parentId:
            m.parentSourceId === null
              ? null
              : (ids.get(m.parentSourceId) ?? null),
          parts: m.parts,
          role: m.role,
          status: m.status,
        }))
      );
    }
    // After the messages: the active leaf must exist.
    await tx.insert(conversationParticipant).values({
      activeLeafId: leaf ?? null,
      conversationId: row.id,
      userId: ownerId,
    });
    return row.id;
  });

/**
 * Imports conversations for `ownerId` into `context`. The caller has checked
 * the user may use that context. Invalid conversations are reported in
 * `failures` and skipped; database errors are bugs or outages and throw.
 * Takes an iterable or async iterable, so a streamed export is written as
 * it's parsed.
 */
export const persistImport = async (
  db: Db,
  ownerId: UserId,
  context: StoredContext,
  inputs: Iterable<ImportInput> | AsyncIterable<ImportInput>
): AsyncResult<ImportResult, NothingImportedError> => {
  const failures: ConversationFailure[] = [];
  const imported: ImportedSummary[] = [];
  let messageCount = 0;
  let index = 0;
  for await (const input of inputs) {
    const position = index;
    index += 1;
    const parsed = unwrap(input, position);
    if (!parsed.ok) {
      failures.push(parsed.error);
      continue;
    }
    const { value } = parsed;
    if (value.messages.length === 0) {
      failures.push({
        index: position,
        reason: "empty",
        sourceId: value.sourceId,
      });
      continue;
    }
    const tree = checkTree(value.messages);
    if (!tree.ok) {
      failures.push({
        detail: tree.error,
        index: position,
        reason: "invalid_tree",
        sourceId: value.sourceId,
      });
      continue;
    }
    const conversationId = await writeConversation(db, ownerId, context, value);
    imported.push({
      conversationId,
      index: position,
      messageCount: value.messages.length,
      sourceId: value.sourceId,
    });
    messageCount += value.messages.length;
  }
  if (imported.length === 0 && failures.length > 0) {
    return err({ failures, type: "nothing_imported" });
  }
  return ok({ failures, imported, messageCount });
};
