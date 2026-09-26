import type { JsonValue } from "@workspace/contract/schemas/common";
import {
  type DeciderAnswer,
  type DeciderQuestion,
  deciderAdapterSchema,
  deciderPurposeSchema,
} from "@workspace/contract/schemas/decider";
import { feedbackRatingSchema } from "@workspace/contract/schemas/feedback";
import type { ModelRef } from "@workspace/contract/schemas/models";
import {
  type ChatContextType,
  chatContextTypeSchema,
} from "@workspace/contract/schemas/tenancy";
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  real,
  text,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import type { z } from "zod";

import { user } from "./auth";
import { conversation, message, run } from "./chat";
import {
  contextIdRef,
  createdAt,
  idColumn,
  idRef,
  instant,
  oneOf,
  updatedAt,
} from "./columns";
import { agent, agentVersion } from "./library";

// Feedback, evals, sampled quality scores (D21) and the Decider's log (D15).
// Eval tables land now so M1's schema is whole; the Agents+ wave fills them.

/** Thumbs on an assistant message; one per user per message. */
export const feedback = pgTable(
  "feedback",
  {
    comment: text("comment"),
    createdAt: createdAt(),
    id: idColumn("feedback"),
    messageId: idRef("message_id", "message")
      .notNull()
      .references(() => message.id, { onDelete: "cascade" }),
    rating: text("rating")
      .$type<z.infer<typeof feedbackRatingSchema>>()
      .notNull(),
    /** "Share this conversation with the agent's maintainers". */
    shareWithMaintainers: boolean("share_with_maintainers")
      .notNull()
      .default(false),
    updatedAt: updatedAt(),
    userId: idRef("user_id", "user")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (t) => [
    uniqueIndex("feedback_message_user_uidx").on(t.messageId, t.userId),
    check("feedback_rating", oneOf(t.rating, feedbackRatingSchema.options)),
  ]
);

/** An agent's test set. */
export const evalDataset = pgTable(
  "eval_dataset",
  {
    agentId: idRef("agent_id", "libraryItem")
      .notNull()
      .references(() => agent.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
    createdBy: idRef("created_by", "user").references(() => user.id, {
      onDelete: "set null",
    }),
    id: idColumn("evalDataset"),
    name: text("name").notNull(),
    updatedAt: updatedAt(),
  },
  (t) => [index("eval_dataset_agent_idx").on(t.agentId)]
);

/** An input with an expected output or a rubric. */
export const evalCase = pgTable(
  "eval_case",
  {
    createdAt: createdAt(),
    datasetId: idRef("dataset_id", "evalDataset")
      .notNull()
      .references(() => evalDataset.id, { onDelete: "cascade" }),
    expected: jsonb("expected").$type<JsonValue>(),
    id: idColumn("evalCase"),
    input: jsonb("input").$type<JsonValue>().notNull(),
    rubric: text("rubric"),
    /** The message a case was made from ("turn this into a test case"). */
    sourceMessageId: idRef("source_message_id", "message").references(
      () => message.id,
      { onDelete: "set null" }
    ),
  },
  (t) => [index("eval_case_dataset_idx").on(t.datasetId)]
);

export const EVAL_RUN_STATUSES = [
  "queued",
  "running",
  "succeeded",
  "failed",
  "cancelled",
] as const;

/** A dataset run against one agent version ("v4 vs v3: 18/20 → 19/20"). */
export const evalRun = pgTable(
  "eval_run",
  {
    agentVersionId: idRef("agent_version_id", "libraryVersion")
      .notNull()
      .references(() => agentVersion.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
    createdBy: idRef("created_by", "user").references(() => user.id, {
      onDelete: "set null",
    }),
    datasetId: idRef("dataset_id", "evalDataset")
      .notNull()
      .references(() => evalDataset.id, { onDelete: "cascade" }),
    finishedAt: instant("finished_at"),
    id: idColumn("evalRun"),
    passed: integer("passed"),
    startedAt: instant("started_at"),
    status: text("status")
      .$type<(typeof EVAL_RUN_STATUSES)[number]>()
      .notNull(),
    total: integer("total"),
  },
  (t) => [
    index("eval_run_version_idx").on(t.agentVersionId, t.createdAt),
    check("eval_run_status", oneOf(t.status, EVAL_RUN_STATUSES)),
  ]
);

/** One case under one scorer. */
export const evalResult = pgTable(
  "eval_result",
  {
    caseId: idRef("case_id", "evalCase")
      .notNull()
      .references(() => evalCase.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
    details: jsonb("details").$type<JsonValue>(),
    id: idColumn("evalResult"),
    output: jsonb("output").$type<JsonValue>(),
    passed: boolean("passed"),
    runId: idRef("run_id", "evalRun")
      .notNull()
      .references(() => evalRun.id, { onDelete: "cascade" }),
    score: real("score"),
    /** `deterministic:<name>`, `llm-judge`, `decider`. */
    scorer: text("scorer").notNull(),
  },
  (t) => [
    uniqueIndex("eval_result_run_case_scorer_uidx").on(
      t.runId,
      t.caseId,
      t.scorer
    ),
  ]
);

/**
 * A sampled production score (Agents+ wave). Maintainers see aggregates
 * only, so the context is kept for filtering, not the content.
 */
export const qualityScore = pgTable(
  "quality_score",
  {
    agentVersionId: idRef("agent_version_id", "libraryVersion").references(
      () => agentVersion.id,
      { onDelete: "set null" }
    ),
    contextId: contextIdRef("context_id").notNull(),
    contextType: text("context_type").$type<ChatContextType>().notNull(),
    createdAt: createdAt(),
    id: idColumn("qualityScore"),
    messageId: idRef("message_id", "message")
      .notNull()
      .references(() => message.id, { onDelete: "cascade" }),
    /** `groundedness`, `helpfulness`, … */
    metric: text("metric").notNull(),
    model: text("model").$type<ModelRef>(),
    score: real("score").notNull(),
    scorer: text("scorer").notNull(),
  },
  (t) => [
    index("quality_score_version_idx").on(t.agentVersionId, t.metric),
    index("quality_score_context_idx").on(t.contextType, t.contextId),
    check(
      "quality_score_context_type",
      oneOf(t.contextType, chatContextTypeSchema.options)
    ),
    check("quality_score_range", sql`${t.score} between 0 and 1`),
  ]
);

/** Every Decider call (D15), answered or not. */
export const decisionLog = pgTable(
  "decision_log",
  {
    adapter: text("adapter")
      .$type<z.infer<typeof deciderAdapterSchema>>()
      .notNull(),
    /** `null` when the adapter failed and the caller used its default. */
    answer: jsonb("answer").$type<DeciderAnswer>(),
    conversationId: idRef("conversation_id", "conversation").references(
      () => conversation.id,
      { onDelete: "set null" }
    ),
    createdAt: createdAt(),
    error: text("error"),
    id: idColumn("decision"),
    latencyMs: integer("latency_ms").notNull(),
    model: text("model").$type<ModelRef>(),
    purpose: text("purpose")
      .$type<z.infer<typeof deciderPurposeSchema>>()
      .notNull(),
    question: jsonb("question").$type<DeciderQuestion>().notNull(),
    runId: idRef("run_id", "run").references(() => run.id, {
      onDelete: "set null",
    }),
    userId: idRef("user_id", "user").references(() => user.id, {
      onDelete: "set null",
    }),
  },
  (t) => [
    index("decision_log_conversation_idx").on(t.conversationId, t.createdAt),
    index("decision_log_run_idx").on(t.runId),
    index("decision_log_purpose_idx").on(t.purpose, t.createdAt),
    check(
      "decision_log_adapter",
      oneOf(t.adapter, deciderAdapterSchema.options)
    ),
    check(
      "decision_log_purpose",
      oneOf(t.purpose, deciderPurposeSchema.options)
    ),
    check("decision_log_latency_non_negative", sql`${t.latencyMs} >= 0`),
  ]
);
