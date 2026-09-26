import type {
  ConversationId,
  MessageId,
  UserId,
} from "@workspace/contract/schemas/common";
import type { Db } from "@workspace/db/client";
import { type NotFoundError, notFound } from "@workspace/db/errors";
import type { StoredContext } from "@workspace/db/queries/conversations";
import {
  conversation,
  conversationParticipant,
  message,
} from "@workspace/db/schema/chat";
import { newId } from "@workspace/shared/ids";
import { type AsyncResult, err, ok } from "@workspace/shared/result";
import { asc, eq, sql } from "drizzle-orm";
import { z } from "zod";

import { orderParentsFirst } from "./tree";

// Fork (PLAN.md §8 Branching): copy part of a conversation's tree into a new
// conversation. Ported from LibreChat's `fork.js` and `lineage.ts` (MIT, see
// NOTICE). The selection is pure (`selectForFork`); `forkConversation`
// reads the source tree and writes the copy.

/** Rows per insert: well under Postgres's 65,535 bind parameters. */
const BATCH = 500;

export const forkModeSchema = z.enum([
  /** The branch ending at the target: the target and its ancestors. */
  "direct-path",
  /** The branch plus every sibling along it, without the target's children. */
  "include-branches",
  /** Every message from the roots down to the target's depth, across all branches. */
  "target-level",
]);
export type ForkMode = z.infer<typeof forkModeSchema>;

interface TreeNode {
  readonly id: string;
  readonly parentId: string | null;
}

/** The target and its ancestors, root first. */
const directPath = <N extends TreeNode>(
  byId: ReadonlyMap<string, N>,
  target: N
): N[] => {
  const path: N[] = [];
  const seen = new Set<string>();
  let node: N | undefined = target;
  while (node && !seen.has(node.id)) {
    seen.add(node.id);
    path.push(node);
    node = node.parentId === null ? undefined : byId.get(node.parentId);
  }
  return path.reverse();
};

/**
 * LibreChat's `getAllMessagesUpToParent`: the path, plus the children of
 * every message on it except the target. Unlike LibreChat this also keeps
 * sibling roots (a first message edited in place), since they're siblings
 * on the path like any other.
 */
const includeBranches = <N extends TreeNode>(
  nodes: readonly N[],
  path: readonly N[],
  target: N
): N[] => {
  const onPath = new Set(path.map((node) => node.id));
  const rootOnPath = path[0]?.parentId === null;
  return nodes.filter(
    (node) =>
      onPath.has(node.id) ||
      (node.parentId === null
        ? rootOnPath
        : onPath.has(node.parentId) && node.parentId !== target.id)
  );
};

/**
 * LibreChat's `getMessagesUpToTargetLevel`: walk the tree level by level
 * from the roots and keep every message until the level holding the target.
 */
const targetLevel = <N extends TreeNode>(
  nodes: readonly N[],
  target: N
): N[] => {
  const children = new Map<string | null, N[]>();
  for (const node of nodes) {
    const siblings = children.get(node.parentId);
    if (siblings) {
      siblings.push(node);
    } else {
      children.set(node.parentId, [node]);
    }
  }
  const kept = new Set<string>();
  const seen = new Set<string>();
  let level = children.get(null) ?? [];
  while (level.length > 0) {
    const next: N[] = [];
    for (const node of level) {
      if (seen.has(node.id)) {
        continue;
      }
      seen.add(node.id);
      kept.add(node.id);
      next.push(...(children.get(node.id) ?? []));
    }
    if (level.some((node) => node.id === target.id)) {
      break;
    }
    level = next;
  }
  return nodes.filter((node) => kept.has(node.id));
};

/**
 * The nodes a fork of `targetId` copies, in input order; `undefined` if the
 * target isn't among `nodes`.
 */
export const selectForFork = <N extends TreeNode>(
  nodes: readonly N[],
  targetId: string,
  mode: ForkMode
): N[] | undefined => {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const target = byId.get(targetId);
  if (!target) {
    return;
  }
  const path = directPath(byId, target);
  switch (mode) {
    case "direct-path": {
      const onPath = new Set(path.map((node) => node.id));
      return nodes.filter((node) => onPath.has(node.id));
    }
    case "include-branches":
      return includeBranches(nodes, path, target);
    case "target-level":
      return targetLevel(nodes, target);
    default:
      return mode satisfies never;
  }
};

export interface ForkInput {
  /** Defaults to the source conversation's context. */
  readonly context?: StoredContext;
  readonly conversationId: ConversationId;
  readonly leafMessageId: MessageId;
  /** Defaults to `direct-path`: the contract's fork copies "the branch ending at `leafId`". */
  readonly mode?: ForkMode;
  /** Who owns the copy: the caller, who may not own the source. */
  readonly ownerId: UserId;
  /** Defaults to the source conversation's title. */
  readonly title?: string;
}

export interface ForkResult {
  readonly conversationId: ConversationId;
  /** The copy of `leafMessageId`, which is the new conversation's active leaf. */
  readonly leafId: MessageId;
  readonly messageCount: number;
}

/**
 * Copies part of a conversation into a new one owned by `ownerId`. Messages
 * keep their parts, authors, models and timestamps; they lose their runs
 * (which belong to the source) and usage (already accounted for there). The
 * caller has checked `ownerId` may read the source and use the context.
 */
export const forkConversation = async (
  db: Db,
  input: ForkInput
): AsyncResult<ForkResult, NotFoundError> => {
  const [source] = await db
    .select()
    .from(conversation)
    .where(eq(conversation.id, input.conversationId));
  if (!source) {
    return err(notFound("conversation", input.conversationId));
  }
  const rows = await db
    .select({
      agentId: message.agentId,
      agentVersionId: message.agentVersionId,
      authorId: message.authorId,
      createdAt: message.createdAt,
      id: message.id,
      model: message.model,
      parentId: message.parentId,
      parts: message.parts,
      partsVersion: message.partsVersion,
      role: message.role,
      status: message.status,
    })
    .from(message)
    .where(eq(message.conversationId, input.conversationId))
    .orderBy(asc(message.createdAt), asc(message.id));
  const selected = selectForFork(
    rows,
    input.leafMessageId,
    input.mode ?? "direct-path"
  );
  if (!selected) {
    return err(notFound("message", input.leafMessageId));
  }
  const ordered = orderParentsFirst(selected);
  const ids = new Map(ordered.map((row) => [row.id, newId("message")]));
  const leafId = ids.get(input.leafMessageId) as MessageId;
  const context = input.context ?? {
    id: source.contextId,
    type: source.contextType,
  };
  const conversationId = await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(conversation)
      .values({
        contextId: context.id,
        contextLockedAt: sql`now()`,
        contextType: context.type,
        defaultTarget: source.defaultTarget,
        lastMessageAt: ordered.reduce(
          (latest, m) => (m.createdAt > latest ? m.createdAt : latest),
          ordered[0]?.createdAt ?? new Date(0)
        ),
        ownerId: input.ownerId,
        title: input.title ?? source.title,
      })
      .returning({ id: conversation.id });
    if (!row) {
      throw new Error("insert returned no row");
    }
    for (let i = 0; i < ordered.length; i += BATCH) {
      // biome-ignore lint/performance/noAwaitInLoops: batches run in order, so each one's parents are already written.
      await tx.insert(message).values(
        ordered.slice(i, i + BATCH).map((m) => ({
          ...m,
          conversationId: row.id,
          id: ids.get(m.id) as MessageId,
          parentId: m.parentId === null ? null : (ids.get(m.parentId) ?? null),
        }))
      );
    }
    // After the messages: the active leaf must exist.
    await tx.insert(conversationParticipant).values({
      activeLeafId: leafId,
      conversationId: row.id,
      userId: input.ownerId,
    });
    return row.id;
  });
  return ok({ conversationId, leafId, messageCount: ordered.length });
};
