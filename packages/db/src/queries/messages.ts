import type {
  ConversationId,
  MessageId,
  RunId,
  UserId,
} from "@workspace/contract/schemas/common";
import type { MessagePart } from "@workspace/contract/schemas/message-parts";
import type {
  Message,
  MessageNode,
  MessageRole,
  MessageStatus,
  SiblingInfo,
} from "@workspace/contract/schemas/messages";
import type { ModelRef, TokenUsage } from "@workspace/contract/schemas/models";
import type { Id } from "@workspace/shared/ids";
import {
  type AsyncResult,
  err,
  ok,
  type Result,
} from "@workspace/shared/result";
import {
  and,
  asc,
  desc,
  eq,
  getColumns,
  inArray,
  isNull,
  or,
  sql,
} from "drizzle-orm";

import type { Db } from "../client";
import {
  type ConflictError,
  conflict,
  type NotFoundError,
  notFound,
  type UnsupportedPartsVersionError,
} from "../errors";
import { conversation, message } from "../schema/chat";
import { rowsOf } from "./page";

// Messages form a tree per conversation (`parentId`). Editing or
// regenerating adds a sibling; a branch is the path from a root to a leaf.
// Reads never return `text_search`: it's an index, not content.

const { textSearch: _textSearch, ...messageColumns } = getColumns(message);

export type MessageRow = Omit<typeof message.$inferSelect, "textSearch">;

export interface NewMessage {
  readonly agent?: {
    readonly id: Id<"libraryItem">;
    readonly versionId: Id<"libraryVersion">;
  } | null;
  readonly authorId: UserId | null;
  readonly conversationId: ConversationId;
  /** Minted by the caller when it needs the id up front (a run's assistant message). */
  readonly id?: MessageId;
  readonly model?: ModelRef | null;
  readonly parentId: MessageId | null;
  readonly parts: readonly MessagePart[];
  readonly role: MessageRole;
  readonly runId?: RunId | null;
  readonly status?: MessageStatus;
  readonly usage?: TokenUsage | null;
}

/**
 * Adds a message and fixes the conversation's context (its first message
 * locks it, D17). The parent must be in the same conversation.
 */
export const insertMessage = (
  db: Db,
  input: NewMessage
): AsyncResult<MessageRow, NotFoundError | ConflictError> =>
  db.transaction(async (tx) => {
    const [owner] = await tx
      .select({ id: conversation.id })
      .from(conversation)
      .where(eq(conversation.id, input.conversationId))
      .for("update");
    if (!owner) {
      return err(notFound("conversation", input.conversationId));
    }
    if (input.parentId !== null) {
      const [parent] = await tx
        .select({ conversationId: message.conversationId })
        .from(message)
        .where(eq(message.id, input.parentId));
      if (!parent) {
        return err(notFound("message", input.parentId));
      }
      if (parent.conversationId !== input.conversationId) {
        return err(conflict("wrong_conversation"));
      }
    }
    const [row] = await tx
      .insert(message)
      .values({
        agentId: input.agent?.id ?? null,
        agentVersionId: input.agent?.versionId ?? null,
        authorId: input.authorId,
        conversationId: input.conversationId,
        id: input.id,
        model: input.model ?? null,
        parentId: input.parentId,
        parts: [...input.parts],
        role: input.role,
        runId: input.runId ?? null,
        status: input.status ?? "complete",
        usage: input.usage ?? null,
      })
      .returning(messageColumns);
    if (!row) {
      throw new Error("insert returned no row");
    }
    await tx
      .update(conversation)
      .set({
        contextLockedAt: sql`coalesce(${conversation.contextLockedAt}, now())`,
        lastMessageAt: row.createdAt,
      })
      .where(eq(conversation.id, input.conversationId));
    return ok(row);
  });

/** What a finishing run writes onto its assistant message. */
export interface MessagePatch {
  readonly model?: ModelRef | null;
  readonly parts?: readonly MessagePart[];
  readonly status?: MessageStatus;
  readonly usage?: TokenUsage | null;
}

export const updateMessage = async (
  db: Db,
  id: MessageId,
  patch: MessagePatch
): AsyncResult<MessageRow, NotFoundError> => {
  const [row] = await db
    .update(message)
    .set({
      ...(patch.model === undefined ? {} : { model: patch.model }),
      ...(patch.parts === undefined ? {} : { parts: [...patch.parts] }),
      ...(patch.status === undefined ? {} : { status: patch.status }),
      ...(patch.usage === undefined ? {} : { usage: patch.usage }),
    })
    .where(eq(message.id, id))
    .returning(messageColumns);
  return row ? ok(row) : err(notFound("message", id));
};

export const getMessage = async (
  db: Db,
  id: MessageId
): AsyncResult<MessageRow, NotFoundError> => {
  const [row] = await db
    .select(messageColumns)
    .from(message)
    .where(eq(message.id, id));
  return row ? ok(row) : err(notFound("message", id));
};

/**
 * The newest message, which is always a leaf (a child is written after its
 * parent). `null` for an empty conversation.
 */
export const newestLeafId = async (
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

/** The whole tree's shape, without content: for the branch map and leaf lookup. */
export const getMessageTree = async (
  db: Db,
  conversationId: ConversationId
): Promise<MessageNode[]> => {
  const rows = await db
    .select({
      createdAt: message.createdAt,
      id: message.id,
      parentId: message.parentId,
      role: message.role,
    })
    .from(message)
    .where(eq(message.conversationId, conversationId))
    .orderBy(asc(message.createdAt), asc(message.id));
  return rows.map((row) => ({
    ...row,
    createdAt: row.createdAt.toISOString(),
  }));
};

/** Sibling info for each message on `path`, from the children of each parent. */
export const siblingInfo = (
  path: readonly Pick<MessageRow, "id" | "parentId">[],
  candidates: readonly Pick<MessageRow, "id" | "parentId">[]
): SiblingInfo[] =>
  path.map((node) => {
    // Candidates arrive oldest first, so the switcher reads "1 / 3" in order.
    const siblingIds = candidates
      .filter((candidate) => candidate.parentId === node.parentId)
      .map((candidate) => candidate.id);
    return {
      index: Math.max(siblingIds.indexOf(node.id), 0),
      messageId: node.id,
      siblingIds: siblingIds.length > 0 ? siblingIds : [node.id],
    };
  });

export interface BranchRows {
  /** Root first. */
  readonly messages: readonly MessageRow[];
  readonly siblings: readonly SiblingInfo[];
}

/**
 * The branch ending at `leafId`, root first, with the siblings of every
 * message on it. One recursive CTE walks up the parents; a second read loads
 * the rows and their siblings.
 */
export const getBranchPath = async (
  db: Db,
  conversationId: ConversationId,
  leafId: MessageId
): AsyncResult<BranchRows, NotFoundError> => {
  const walked = rowsOf<{ depth: number; id: MessageId }>(
    await db.execute(sql`
      with recursive path as (
        select ${message.id} as id, ${message.parentId} as parent_id, 0 as depth
        from ${message}
        where ${message.id} = ${leafId} and ${message.conversationId} = ${conversationId}
        union all
        select m.id, m.parent_id, path.depth + 1
        from ${message} m
        join path on m.id = path.parent_id
      )
      select id, depth from path
    `)
  );
  if (walked.length === 0) {
    return err(notFound("message", leafId));
  }
  const depthOf = new Map(walked.map((row) => [row.id, Number(row.depth)]));
  const rows = await db
    .select(messageColumns)
    .from(message)
    .where(inArray(message.id, [...depthOf.keys()]));
  const messages = [...rows].sort(
    (a, b) => (depthOf.get(b.id) ?? 0) - (depthOf.get(a.id) ?? 0)
  );
  const parentIds = messages.flatMap((row) =>
    row.parentId === null ? [] : [row.parentId]
  );
  const candidates = await db
    .select({ id: message.id, parentId: message.parentId })
    .from(message)
    .where(
      and(
        eq(message.conversationId, conversationId),
        or(
          isNull(message.parentId),
          parentIds.length > 0
            ? inArray(message.parentId, parentIds)
            : undefined
        )
      )
    )
    .orderBy(asc(message.createdAt), asc(message.id));
  return ok({ messages, siblings: siblingInfo(messages, candidates) });
};

/** One message's siblings (children of its parent, oldest first) and its place among them. */
export const getSiblings = async (
  db: Db,
  id: MessageId
): AsyncResult<SiblingInfo, NotFoundError> => {
  const found = await getMessage(db, id);
  if (!found.ok) {
    return found;
  }
  const { conversationId, parentId } = found.value;
  const candidates = await db
    .select({ id: message.id, parentId: message.parentId })
    .from(message)
    .where(
      and(
        eq(message.conversationId, conversationId),
        parentId === null
          ? isNull(message.parentId)
          : eq(message.parentId, parentId)
      )
    )
    .orderBy(asc(message.createdAt), asc(message.id));
  const [info] = siblingInfo([found.value], candidates);
  return info ? ok(info) : err(notFound("message", id));
};

/**
 * A row as the contract's `Message`. Stored parts are read through their
 * `partsVersion` (ticket 008): version 1 is current; a later reader adds a
 * case per old version that upgrades it on read.
 */
export const toMessage = (
  row: MessageRow
): Result<Message, UnsupportedPartsVersionError> => {
  switch (row.partsVersion) {
    case 1:
      return ok({
        agent:
          row.agentId && row.agentVersionId
            ? { id: row.agentId, versionId: row.agentVersionId }
            : null,
        authorId: row.authorId,
        conversationId: row.conversationId,
        createdAt: row.createdAt.toISOString(),
        id: row.id,
        model: row.model,
        parentId: row.parentId,
        parts: row.parts,
        partsVersion: 1,
        role: row.role,
        runId: row.runId,
        status: row.status,
        usage: row.usage,
      });
    default:
      return err({
        messageId: row.id,
        type: "unsupported_parts_version",
        version: row.partsVersion,
      });
  }
};
