import type {
  ConversationId,
  RunId,
  UserId,
} from "@workspace/contract/schemas/common";
import type {
  DeciderAnswer,
  DeciderPurpose,
  DeciderQuestion,
  DecisionLogEntry,
  deciderAdapterSchema,
} from "@workspace/contract/schemas/decider";
import type { ModelRef } from "@workspace/contract/schemas/models";
import { type AsyncResult, err, ok } from "@workspace/shared/result";
import { and, desc, eq, lt } from "drizzle-orm";
import type { z } from "zod";

import type { Db } from "../client";
import { decisionLog } from "../schema/quality";
import {
  decodeCursor,
  type InvalidCursorError,
  type Page,
  toPage,
} from "./page";

// The Decider's log (D15): every call, answered or not, for tuning and audit.

export type DecisionRow = typeof decisionLog.$inferSelect;

export interface NewDecision {
  readonly adapter: z.infer<typeof deciderAdapterSchema>;
  readonly answer: DeciderAnswer | null;
  readonly conversationId?: ConversationId | null;
  readonly error?: string | null;
  readonly latencyMs: number;
  readonly model?: ModelRef | null;
  readonly purpose: DeciderPurpose;
  readonly question: DeciderQuestion;
  readonly runId?: RunId | null;
  readonly userId?: UserId | null;
}

export const logDecision = async (
  db: Db,
  input: NewDecision
): Promise<DecisionRow> => {
  const [row] = await db
    .insert(decisionLog)
    .values({
      adapter: input.adapter,
      answer: input.answer,
      conversationId: input.conversationId ?? null,
      error: input.error ?? null,
      latencyMs: Math.max(0, Math.round(input.latencyMs)),
      model: input.model ?? null,
      purpose: input.purpose,
      question: input.question,
      runId: input.runId ?? null,
      userId: input.userId ?? null,
    })
    .returning();
  if (!row) {
    throw new Error("insert returned no row");
  }
  return row;
};

export interface DecisionFilter {
  readonly conversationId?: ConversationId;
  readonly cursor?: string;
  readonly limit: number;
  readonly purpose?: DeciderPurpose;
  readonly runId?: RunId;
}

/** Newest first. Ids are UUIDv7, so the id alone orders by time. */
export const listDecisions = async (
  db: Db,
  filter: DecisionFilter
): AsyncResult<Page<DecisionRow>, InvalidCursorError> => {
  const cursor = filter.cursor ? decodeCursor(filter.cursor) : undefined;
  if (cursor && !cursor.ok) {
    return err(cursor.error);
  }
  const rows = await db
    .select()
    .from(decisionLog)
    .where(
      and(
        filter.conversationId === undefined
          ? undefined
          : eq(decisionLog.conversationId, filter.conversationId),
        filter.purpose === undefined
          ? undefined
          : eq(decisionLog.purpose, filter.purpose),
        filter.runId === undefined
          ? undefined
          : eq(decisionLog.runId, filter.runId),
        cursor?.ok
          ? lt(decisionLog.id, cursor.value.id as DecisionRow["id"])
          : undefined
      )
    )
    .orderBy(desc(decisionLog.id))
    .limit(filter.limit + 1);
  return ok(
    toPage(rows, filter.limit, (row) => ({
      id: row.id,
      key: row.createdAt.toISOString(),
    }))
  );
};

export const toDecisionLogEntry = (row: DecisionRow): DecisionLogEntry => ({
  adapter: row.adapter,
  answer: row.answer,
  conversationId: row.conversationId,
  createdAt: row.createdAt.toISOString(),
  error: row.error,
  id: row.id,
  latencyMs: row.latencyMs,
  model: row.model,
  purpose: row.purpose,
  question: row.question,
  runId: row.runId,
  userId: row.userId,
});
