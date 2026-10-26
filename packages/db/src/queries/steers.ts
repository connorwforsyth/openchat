import type { MessageId, RunId } from "@workspace/contract/schemas/common";
import { and, asc, eq, ne, sql } from "drizzle-orm";

import type { Db } from "../client";
import { conversation, message, run } from "../schema/chat";
import { getMessage, insertMessage, type MessageRow } from "./messages";
import {
  getRun,
  lockRun,
  type RunRow,
  requeueAfter,
  transitionRun,
} from "./runs";

// Steering (`delivery: "steer"`) and taking a queued turn back. A steer is
// a queued turn like any other until the answer it waits on takes it at a
// step boundary: then the turn's own run ends unrun (`cancelled`, by no
// one), and the running run goes on writing a new answer under the steer's
// message. So the tree reads as it happened (answer, steer, the rest of
// the answer) and every rule about queued turns still holds for a steer
// that is never taken: it runs next, as queued.

/**
 * Locks the run's conversation, then the run. Placing a turn locks the
 * conversation first (`insertMessage`) and then the run it queues behind
 * (its foreign key), so taking these in the other order could deadlock.
 */
const lockInOrder = async (tx: Db, runId: RunId): Promise<RunRow | null> => {
  const found = await getRun(tx, runId);
  if (!found.ok) {
    return null;
  }
  await tx
    .select({ id: conversation.id })
    .from(conversation)
    .where(eq(conversation.id, found.value.conversationId))
    .for("update");
  const locked = await lockRun(tx, runId);
  return locked.ok ? locked.value : null;
};

export interface TakenSteer {
  /** The answer the run writes from here on, under the steer's message. */
  readonly answer: MessageRow;
  /** The answer the steer came after. */
  readonly previousAnswerId: MessageId;
  /** The steer's run, now ended unrun. */
  readonly run: RunRow;
  /** The steer's user message. */
  readonly userMessage: MessageRow;
}

/**
 * Takes the steer waiting next in line behind `runId`, if there is one it
 * can take: queued directly behind the run, under the answer the run is
 * writing. Turns queued behind the steer move after the new answer. All in
 * one transaction,
 * with the run and the steer locked, so a Stop or a claim on either sees
 * the steer either still queued or already taken. `null`: none to take.
 */
export const takeSteer = async (
  db: Db,
  runId: RunId,
  now: Date = new Date()
): Promise<TakenSteer | null> =>
  await db.transaction(async (tx) => {
    const answering = await lockInOrder(tx, runId);
    const previousAnswerId = answering?.assistantMessageId;
    if (answering?.status !== "running" || !previousAnswerId) {
      return null;
    }
    const [steer] = await tx
      .select()
      .from(run)
      .where(
        and(
          eq(run.afterRunId, runId),
          eq(run.status, "queued"),
          sql`${run.options}->>'delivery' = 'steer'`
        )
      )
      .orderBy(asc(run.createdAt), asc(run.id))
      .limit(1)
      .for("update");
    if (!steer) {
      return null;
    }
    const asked = await getMessage(tx, steer.userMessageId);
    if (!asked.ok || asked.value.parentId !== previousAnswerId) {
      return null;
    }
    const answer = await insertMessage(tx, {
      authorId: null,
      conversationId: answering.conversationId,
      mode: answering.options?.chatMode ?? null,
      parentId: steer.userMessageId,
      parts: [],
      role: "assistant",
      runId,
      status: "partial",
    });
    if (!answer.ok) {
      return tx.rollback();
    }
    // Turns queued behind the steer follow the answer that goes on under it,
    // and wait on the run writing it. The answer is dated just after the
    // steer, before them, so a child is still always newer than its parent
    // (`newestLeafId` reads the branch's end that way).
    const [dated] = await tx
      .update(message)
      .set({
        createdAt: sql`(select m.created_at from message m where m.id = ${steer.userMessageId}) + interval '1 microsecond'`,
      })
      .where(eq(message.id, answer.value.id))
      .returning({ createdAt: message.createdAt });
    await tx
      .update(message)
      .set({ parentId: answer.value.id })
      .where(
        and(
          eq(message.parentId, steer.userMessageId),
          ne(message.id, answer.value.id)
        )
      );
    await requeueAfter(tx, steer.id, runId);
    await tx
      .update(run)
      .set({ assistantMessageId: answer.value.id })
      .where(eq(run.id, runId));
    const ended = await transitionRun(
      tx,
      steer.id,
      { cancelledBy: null, type: "cancel" },
      now
    );
    if (!ended.ok) {
      return tx.rollback();
    }
    return {
      answer: dated
        ? { ...answer.value, createdAt: dated.createdAt }
        : answer.value,
      previousAnswerId,
      run: ended.value,
      userMessage: asked.value,
    };
  });

/**
 * A withdrawn turn's message, removed with its run, when nothing came of
 * it: the run ended unrun and no message follows it (a turn queued under
 * it since keeps it, as a stopped question). Run after the turn's run was
 * cancelled. `false` when it stays.
 */
export const removeUnrunTurn = async (db: Db, runId: RunId): Promise<boolean> =>
  await db.transaction(async (tx) => {
    const withdrawn = await lockInOrder(tx, runId);
    if (withdrawn?.status !== "cancelled" || withdrawn.assistantMessageId) {
      return false;
    }
    const { userMessageId } = withdrawn;
    const [asked] = await tx
      .select({ id: message.id })
      .from(message)
      .where(eq(message.id, userMessageId));
    const [follower] = await tx
      .select({ id: message.id })
      .from(message)
      .where(eq(message.parentId, userMessageId))
      .limit(1);
    const [answered] = await tx
      .select({ id: run.id })
      .from(run)
      .where(
        and(eq(run.userMessageId, userMessageId), sql`${run.id} <> ${runId}`)
      )
      .limit(1);
    if (!asked || follower || answered) {
      return false;
    }
    // The run goes with its message (`run.user_message_id` cascades).
    await tx.delete(message).where(eq(message.id, userMessageId));
    return true;
  });

/**
 * Marks a queued turn as a steer: the answer it waits on takes it at its
 * next step. `null` when it isn't queued any more.
 */
export const markSteer = async (
  db: Db,
  runId: RunId
): Promise<RunRow | null> => {
  const [row] = await db
    .update(run)
    .set({
      options: sql`jsonb_set(coalesce(${run.options}, '{}'::jsonb), '{delivery}', '"steer"'::jsonb)`,
    })
    .where(and(eq(run.id, runId), eq(run.status, "queued")))
    .returning();
  return row ?? null;
};
