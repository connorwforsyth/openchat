import type { MessageId, RunId } from "@workspace/contract/schemas/common";
import { and, asc, desc, eq, inArray, ne, sql } from "drizzle-orm";

import type { Db } from "../client";
import { conversation, message, run, runChunk } from "../schema/chat";
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
 * A question and the messages its author sent under it before it was
 * answered, oldest first: the batch one answer covers. A message sent while
 * a turn waits joins its chain, so quick messages get one answer.
 */
export const questionChain = async (
  db: Db,
  firstId: MessageId
): Promise<MessageRow[]> => {
  const first = await getMessage(db, firstId);
  if (!first.ok) {
    return [];
  }
  const chain = [first.value];
  for (;;) {
    const last = chain.at(-1) as MessageRow;
    // biome-ignore lint/performance/noAwaitInLoops: one hop per message in the batch; a few at most.
    const next = await db
      .select({ id: message.id })
      .from(message)
      .where(
        and(
          eq(message.parentId, last.id),
          eq(message.role, "user"),
          first.value.authorId === null
            ? sql`false`
            : eq(message.authorId, first.value.authorId),
          // A turn queued under the question has its own run and answer;
          // only messages that joined the batch have none.
          sql`not exists (select 1 from ${run} where ${run.userMessageId} = ${message.id})`
        )
      )
      .orderBy(asc(message.createdAt), asc(message.id))
      .limit(2);
    const [only] = next;
    if (next.length !== 1 || !only) {
      return chain;
    }
    const row = await getMessage(db, only.id);
    if (!row.ok) {
      return chain;
    }
    chain.push(row.value);
  }
};

/**
 * Locks a conversation for the rest of the transaction. Placing a turn and
 * starting one take it first, so they see each other's messages and runs.
 */
export const lockConversation = async (
  tx: Db,
  conversationId: RunRow["conversationId"]
): Promise<void> => {
  await tx
    .select({ id: conversation.id })
    .from(conversation)
    .where(eq(conversation.id, conversationId))
    .for("update");
};

/**
 * Where a message sent from `anchor` goes, when the thread has gone on
 * past it before the sender's page saw that (quick messages, sent faster
 * than the page refetches):
 *
 * - a question that has been answered since: after its answer;
 * - an answer that was stopped and restarted (a turn queued behind its
 *   run): after the turn that replaced it, or its question until it has an
 *   answer.
 *
 * Otherwise `anchor` itself.
 */
export const followThread = async (
  db: Db,
  anchor: MessageId
): Promise<MessageId> => {
  let current = anchor;
  const seen = new Set<string>();
  for (;;) {
    // biome-ignore lint/performance/noAwaitInLoops: one hop per turn the page missed; a few at most.
    const next = await laterThan(db, current);
    if (!next || seen.has(next)) {
      return current;
    }
    seen.add(next);
    current = next;
  }
};

/**
 * The message in `id`'s batch that has the run: `id` itself, or the first
 * of the quick messages sent under it before it was answered.
 */
const batchHead = async (db: Db, id: MessageId): Promise<MessageId> => {
  let current = id;
  for (;;) {
    // biome-ignore lint/performance/noAwaitInLoops: one hop per message in the batch; a few at most.
    const [own] = await db
      .select({ id: run.id })
      .from(run)
      .where(eq(run.userMessageId, current))
      .limit(1);
    const found = own ? null : await getMessage(db, current);
    const parentId = found?.ok ? found.value.parentId : null;
    const parent = parentId ? await getMessage(db, parentId) : null;
    if (
      !(parent?.ok && found?.ok) ||
      parent.value.role !== "user" ||
      parent.value.authorId !== found.value.authorId
    ) {
      return current;
    }
    current = parent.value.id;
  }
};

/** One hop of `followThread`; `null` when `id` is where the thread is. */
const laterThan = async (db: Db, id: MessageId): Promise<MessageId | null> => {
  const found = await getMessage(db, id);
  if (!found.ok) {
    return null;
  }
  if (found.value.role === "user") {
    // A question (or a batch of them) answered since: after the answer.
    const head = await batchHead(db, id);
    const end = (await questionChain(db, head)).at(-1)?.id ?? head;
    const [answer] = await db
      .select({ id: message.id })
      .from(message)
      .where(and(eq(message.parentId, end), eq(message.role, "assistant")))
      .orderBy(desc(message.createdAt), desc(message.id))
      .limit(1);
    if (answer) {
      return answer.id;
    }
    // Still waiting: its batch's run is the one to find.
    return head === id ? null : head;
  }
  const { runId } = found.value;
  if (!runId) {
    return null;
  }
  const ended = await getRun(db, runId);
  if (!ended.ok || ended.value.status !== "cancelled") {
    return null;
  }
  const [after] = await db
    .select()
    .from(run)
    .where(eq(run.afterRunId, runId))
    .orderBy(asc(run.createdAt), asc(run.id))
    .limit(1);
  return after ? (after.assistantMessageId ?? after.userMessageId) : null;
};

/**
 * A queued turn whose question waits under the question ahead (it had no
 * answer when this was sent), moved under that question's answer as it
 * starts: the thread reads question, answer, question, answer, instead of
 * forking at the first question. Dated now, so it's still newer than its
 * new parent. Only a fresh question (no answer or turn under it yet) after an answer
 * that stands (its run succeeded) moves: a restart's message stays beside
 * the answer it stopped, and a regenerated question keeps its place.
 */
export const followAnswerAhead = async (
  tx: Db,
  userMessageId: MessageId
): Promise<void> => {
  const asked = await getMessage(tx, userMessageId);
  const parentId = asked.ok ? asked.value.parentId : null;
  // Messages that joined its batch move with it; an answer or a turn of
  // its own under it means it's been placed for good.
  const [child] = await tx
    .select({ id: message.id })
    .from(message)
    .where(
      and(
        eq(message.parentId, userMessageId),
        sql`(${message.role} <> 'user' or exists (select 1 from ${run} where ${run.userMessageId} = ${message.id}))`
      )
    )
    .limit(1);
  if (!parentId || child) {
    return;
  }
  const [ahead] = await tx
    .select({ answerId: run.assistantMessageId })
    .from(run)
    .where(and(eq(run.userMessageId, parentId), eq(run.status, "succeeded")))
    .orderBy(desc(run.createdAt), desc(run.id))
    .limit(1);
  if (!ahead?.answerId) {
    return;
  }
  await tx
    .update(message)
    .set({ parentId: ahead.answerId })
    .where(eq(message.id, userMessageId));
  // Re-dated in order, just before this transaction's `now()` (when the run's
  // answer is stamped): after the answer ahead, before the new answer.
  const batch = await questionChain(tx, userMessageId);
  for (const [index, each] of batch.entries()) {
    // biome-ignore lint/performance/noAwaitInLoops: one per message in the batch; a few at most.
    await tx
      .update(message)
      .set({
        createdAt: sql`now() - ${`${batch.length - index} microseconds`}::interval`,
      })
      .where(eq(message.id, each.id));
  }
};

/**
 * Where a run's answer goes: under the last message of its question's
 * batch. Locks the conversation first, as placing a message does, so a
 * message can't join the batch after this read and end up beside the answer.
 */
export const batchEnd = async (
  tx: Db,
  conversationId: RunRow["conversationId"],
  firstId: MessageId
): Promise<MessageId> => {
  await lockConversation(tx, conversationId);
  return (await questionChain(tx, firstId)).at(-1)?.id ?? firstId;
};

// What a run streams once it starts work it would lose by restarting.
const TOOL_CHUNKS = [
  "tool-input-start",
  "tool-input-available",
  "tool-output-available",
];

/** Whether a run's answer has begun calling tools (from its stream so far). */
export const toolWorkStarted = async (
  db: Db,
  runId: RunId
): Promise<boolean> => {
  const [row] = await db
    .select({ seq: runChunk.seq })
    .from(runChunk)
    .where(
      and(
        eq(runChunk.runId, runId),
        inArray(sql<string>`${runChunk.payload}->>'type'`, TOOL_CHUNKS)
      )
    )
    .limit(1);
  return row !== undefined;
};

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
  await lockConversation(tx, found.value.conversationId);
  const locked = await lockRun(tx, runId);
  return locked.ok ? locked.value : null;
};

/** The steer next in line behind a running run, and the answer it follows. */
export interface SteerCandidate {
  /** The answer the run is writing, which the steer comes after. */
  readonly answerId: MessageId;
  /** The steer's own run. */
  readonly runId: RunId;
  /** The steer's message and any sent under it since, oldest first. */
  readonly userMessages: readonly MessageRow[];
}

/**
 * The steer `answering` could take: queued directly behind it, by the same
 * person (the run goes on as its creator: memory, budget, files), under the
 * answer it is writing. `lock` locks the steer's row too.
 */
const steerBehind = async (
  db: Db,
  answering: RunRow,
  lock: boolean
): Promise<SteerCandidate | null> => {
  const answerId = answering.assistantMessageId;
  if (answering.status !== "running" || !answerId) {
    return null;
  }
  const query = db
    .select()
    .from(run)
    .where(
      and(
        eq(run.afterRunId, answering.id),
        eq(run.status, "queued"),
        eq(run.createdBy, answering.createdBy),
        sql`${run.options}->>'delivery' = 'steer'`
      )
    )
    .orderBy(asc(run.createdAt), asc(run.id))
    .limit(1);
  const [steer] = lock ? await query.for("update") : await query;
  if (!steer) {
    return null;
  }
  const asked = await questionChain(db, steer.userMessageId);
  return asked[0]?.parentId === answerId
    ? { answerId, runId: steer.id, userMessages: asked }
    : null;
};

/**
 * The steer a running run would take next, read without locks: the caller
 * prepares what the model reads from it (which may read files) outside any
 * transaction, then takes it with `takeSteer`.
 */
export const nextSteer = async (
  db: Db,
  runId: RunId
): Promise<SteerCandidate | null> => {
  const answering = await getRun(db, runId);
  return answering.ok ? await steerBehind(db, answering.value, false) : null;
};

export interface TakenSteer {
  /** The answer the run writes from here on, under the steer's message. */
  readonly answer: MessageRow;
  /** The answer the steer came after. */
  readonly previousAnswerId: MessageId;
  /** The steer's run, now ended unrun. */
  readonly run: RunRow;
  /** The steer's messages, oldest first. */
  readonly userMessages: readonly MessageRow[];
}

/**
 * Takes the steer waiting next in line behind `runId`, if there is one it
 * can take: queued directly behind the run, under the answer the run is
 * writing. Turns queued behind the steer move after the new answer. All in
 * one transaction, with the run and the steer locked, so a Stop or a claim
 * on either sees the steer either still queued or already taken.
 *
 * It takes only the steer the caller prepared (`expected`, from
 * `nextSteer`), still next and still after the same answer; anything else
 * is `null`, and the next step boundary looks again. Only database work
 * happens under the locks. `null`: none to take.
 */
export const takeSteer = async (
  db: Db,
  runId: RunId,
  expected: SteerCandidate,
  now: Date = new Date()
): Promise<TakenSteer | null> =>
  await db.transaction(async (tx) => {
    const answering = await lockInOrder(tx, runId);
    const found = answering ? await steerBehind(tx, answering, true) : null;
    if (
      !(answering && found) ||
      found.runId !== expected.runId ||
      found.answerId !== expected.answerId ||
      // A message that joined the batch since wasn't prepared: next time.
      found.userMessages.at(-1)?.id !== expected.userMessages.at(-1)?.id
    ) {
      return null;
    }
    const asked = found.userMessages.at(-1) as MessageRow;
    const answer = await insertMessage(tx, {
      authorId: null,
      conversationId: answering.conversationId,
      mode: answering.options?.chatMode ?? null,
      parentId: asked.id,
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
        createdAt: sql`(select m.created_at from message m where m.id = ${asked.id}) + interval '1 microsecond'`,
      })
      .where(eq(message.id, answer.value.id))
      .returning({ createdAt: message.createdAt });
    await tx
      .update(message)
      .set({ parentId: answer.value.id })
      .where(
        and(eq(message.parentId, asked.id), ne(message.id, answer.value.id))
      );
    await requeueAfter(tx, found.runId, runId);
    await tx
      .update(run)
      .set({ assistantMessageId: answer.value.id })
      .where(eq(run.id, runId));
    const ended = await transitionRun(
      tx,
      found.runId,
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
      previousAnswerId: found.answerId,
      run: ended.value,
      userMessages: found.userMessages,
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
