import type {
  LibraryItemId,
  MessageId,
  UserId,
} from "@workspace/contract/schemas/common";
import type {
  Feedback,
  feedbackRatingSchema,
} from "@workspace/contract/schemas/feedback";
import { type AsyncResult, err, ok } from "@workspace/shared/result";
import { and, count, eq } from "drizzle-orm";
import type { z } from "zod";

import type { Db } from "../client";
import { type NotFoundError, notFound } from "../errors";
import { message } from "../schema/chat";
import { feedback } from "../schema/quality";

// Thumbs feedback (D21): one per user per message; setting it again
// replaces it. Maintainers see aggregates (`feedbackTotals`), never rows,
// unless a user shared the conversation.

export type FeedbackRow = typeof feedback.$inferSelect;

export interface FeedbackInput {
  readonly comment?: string | null;
  readonly messageId: MessageId;
  readonly rating: z.infer<typeof feedbackRatingSchema>;
  readonly shareWithMaintainers?: boolean;
  readonly userId: UserId;
}

export const setFeedback = async (
  db: Db,
  input: FeedbackInput
): AsyncResult<FeedbackRow, NotFoundError> => {
  const [target] = await db
    .select({ id: message.id })
    .from(message)
    .where(eq(message.id, input.messageId));
  if (!target) {
    return err(notFound("message", input.messageId));
  }
  const values = {
    comment: input.comment ?? null,
    rating: input.rating,
    shareWithMaintainers: input.shareWithMaintainers ?? false,
  };
  const [row] = await db
    .insert(feedback)
    .values({ ...values, messageId: input.messageId, userId: input.userId })
    .onConflictDoUpdate({
      set: { ...values, updatedAt: new Date() },
      target: [feedback.messageId, feedback.userId],
    })
    .returning();
  if (!row) {
    throw new Error("upsert returned no row");
  }
  return ok(row);
};

export const getFeedback = async (
  db: Db,
  messageId: MessageId,
  userId: UserId
): Promise<FeedbackRow | null> => {
  const [row] = await db
    .select()
    .from(feedback)
    .where(and(eq(feedback.messageId, messageId), eq(feedback.userId, userId)));
  return row ?? null;
};

export const deleteFeedback = async (
  db: Db,
  messageId: MessageId,
  userId: UserId
): Promise<boolean> => {
  const deleted = await db
    .delete(feedback)
    .where(and(eq(feedback.messageId, messageId), eq(feedback.userId, userId)))
    .returning({ id: feedback.id });
  return deleted.length > 0;
};

/** Ups and downs across an agent's answers: all a maintainer sees by default. */
export const feedbackTotals = async (
  db: Db,
  agentId: LibraryItemId
): Promise<{ readonly down: number; readonly up: number }> => {
  const rows = await db
    .select({ n: count(), rating: feedback.rating })
    .from(feedback)
    .innerJoin(message, eq(message.id, feedback.messageId))
    .where(eq(message.agentId, agentId))
    .groupBy(feedback.rating);
  const of = (rating: string) =>
    Number(rows.find((row) => row.rating === rating)?.n ?? 0);
  return { down: of("down"), up: of("up") };
};

export const toFeedback = (row: FeedbackRow): Feedback => ({
  comment: row.comment,
  createdAt: row.createdAt.toISOString(),
  id: row.id,
  messageId: row.messageId,
  rating: row.rating,
  shareWithMaintainers: row.shareWithMaintainers,
  updatedAt: row.updatedAt.toISOString(),
  userId: row.userId,
});
