import type {
  DotScheduleId,
  JsonValue,
} from "@workspace/contract/schemas/common";
import {
  type MessagePart,
  PARTS_VERSION,
} from "@workspace/contract/schemas/message-parts";
import {
  messageRoleSchema,
  messageStatusSchema,
} from "@workspace/contract/schemas/messages";
import type { ModelRef, TokenUsage } from "@workspace/contract/schemas/models";
import {
  type ChatMode,
  chatModeSchema,
  type PendingApproval,
  type RunError,
  type RunOptions,
  type RunTarget,
  runStatusSchema,
} from "@workspace/contract/schemas/runs";
import {
  type ChatContextType,
  chatContextTypeSchema,
} from "@workspace/contract/schemas/tenancy";
import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  unique,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import { user } from "./auth";
import {
  contextIdRef,
  createdAt,
  idColumn,
  idRef,
  instant,
  oneOf,
  TEXT_SEARCH_CONFIG,
  tsvector,
  updatedAt,
} from "./columns";
import { agent, agentVersion } from "./library";

// Chat (PLAN.md §7, D4, D17, D25): conversations are trees of messages
// (`parentId`), and every turn is a run whose stream is stored in
// `run_chunk` for resume.

export const ACTIVE_RUN_STATUSES = [
  "queued",
  "running",
  "awaiting_approval",
] as const;

/**
 * What a conversation is for. `test` is an Agent Builder test chat (ticket
 * 033): kept out of the chat list and search, and deleted after a while.
 */
export const CONVERSATION_PURPOSES = ["chat", "test"] as const;
export type ConversationPurpose = (typeof CONVERSATION_PURPOSES)[number];

export const conversation = pgTable(
  "conversation",
  {
    archivedAt: instant("archived_at"),
    /**
     * Whose keys pay and where usage rolls up (D17). `personal` stores the
     * owner's personal org id, so every context resolves to an org or team.
     */
    contextId: contextIdRef("context_id").notNull(),
    /** Set by the first message; the context can't change after it. */
    contextLockedAt: instant("context_locked_at"),
    contextType: text("context_type").$type<ChatContextType>().notNull(),
    createdAt: createdAt(),
    /** The agent or model used when a run doesn't name one. */
    defaultTarget: jsonb("default_target").$type<RunTarget>(),
    id: idColumn("conversation"),
    lastMessageAt: instant("last_message_at"),
    /** Chat or Code: which tools its runs get. A run records the mode it started in. */
    mode: text("mode").$type<ChatMode>().notNull().default("chat"),
    ownerId: idRef("owner_id", "user")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    purpose: text("purpose")
      .$type<ConversationPurpose>()
      .notNull()
      .default("chat"),
    /** `null` until the title job names it. */
    title: text("title"),
    titleSearch: tsvector("title_search").generatedAlwaysAs(
      sql.raw(`to_tsvector('${TEXT_SEARCH_CONFIG}', coalesce("title", ''))`)
    ),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("conversation_owner_idx").on(t.ownerId, t.updatedAt.desc()),
    index("conversation_context_idx").on(t.contextType, t.contextId),
    index("conversation_title_search_idx").using("gin", t.titleSearch),
    // The test-chat cleanup's scan; ordinary chats never enter it.
    index("conversation_test_idx")
      .on(t.createdAt)
      .where(sql`${t.purpose} = 'test'`),
    check(
      "conversation_context_type",
      oneOf(t.contextType, chatContextTypeSchema.options)
    ),
    check("conversation_purpose", oneOf(t.purpose, CONVERSATION_PURPOSES)),
    check("conversation_mode", oneOf(t.mode, chatModeSchema.options)),
  ]
);

/**
 * Per-user state in a conversation (D25). It grants nothing: access comes
 * only from ownership and `resource_grant`.
 */
export const conversationParticipant = pgTable(
  "conversation_participant",
  {
    /** The leaf of the branch this user is on; `null` means the newest leaf. */
    activeLeafId: idRef("active_leaf_id", "message").references(
      (): AnyPgColumn => message.id,
      { onDelete: "set null" }
    ),
    conversationId: idRef("conversation_id", "conversation")
      .notNull()
      .references(() => conversation.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
    followingUserId: idRef("following_user_id", "user").references(
      () => user.id,
      { onDelete: "set null" }
    ),
    lastReadAt: instant("last_read_at"),
    /** Pinning is per user: a shared chat pinned by one person isn't pinned for all. */
    pinnedAt: instant("pinned_at"),
    updatedAt: updatedAt(),
    userId: idRef("user_id", "user")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (t) => [
    primaryKey({ columns: [t.conversationId, t.userId] }),
    index("conversation_participant_user_idx").on(t.userId),
  ]
);

export const message = pgTable(
  "message",
  {
    agentId: idRef("agent_id", "libraryItem").references(
      (): AnyPgColumn => agent.id,
      { onDelete: "set null" }
    ),
    /** The agent version that answered, as it was when the run started. */
    agentVersionId: idRef("agent_version_id", "libraryVersion").references(
      (): AnyPgColumn => agentVersion.id,
      { onDelete: "set null" }
    ),
    /** The user who wrote it; `null` for assistant and system messages. */
    authorId: idRef("author_id", "user").references(() => user.id, {
      onDelete: "set null",
    }),
    conversationId: idRef("conversation_id", "conversation")
      .notNull()
      .references(() => conversation.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
    id: idColumn("message"),
    /** The mode its run ran in; `null` outside the switch (a Dot's chat). */
    mode: text("mode").$type<ChatMode>(),
    /** The resolved model ref, never an alias. */
    model: text("model").$type<ModelRef>(),
    /** `null` for a root message. Same conversation (composite key below). */
    parentId: idRef("parent_id", "message"),
    /** Our `MessagePart` union, read through `partsVersion` (Q4, ticket 008). */
    parts: jsonb("parts").$type<MessagePart[]>().notNull(),
    partsVersion: integer("parts_version").notNull().default(PARTS_VERSION),
    role: text("role")
      .$type<(typeof messageRoleSchema.options)[number]>()
      .notNull(),
    runId: idRef("run_id", "run").references((): AnyPgColumn => run.id, {
      onDelete: "set null",
    }),
    status: text("status")
      .$type<(typeof messageStatusSchema.options)[number]>()
      .notNull()
      .default("complete"),
    /** Text parts only, for chat search (D1). */
    textSearch: tsvector("text_search").generatedAlwaysAs(
      sql.raw(
        `to_tsvector('${TEXT_SEARCH_CONFIG}', jsonb_path_query_array("parts", '$[*] ? (@.type == "text").text'))`
      )
    ),
    updatedAt: updatedAt(),
    usage: jsonb("usage").$type<TokenUsage>(),
  },
  (t) => [
    // The target of the parent key, so a parent is always in the same conversation.
    unique("message_conversation_id_id_unique").on(t.conversationId, t.id),
    foreignKey({
      columns: [t.conversationId, t.parentId],
      foreignColumns: [t.conversationId, t.id],
      name: "message_parent_fk",
    }).onDelete("cascade"),
    // Children of a parent in order: siblings for the branch switcher, and the tree walk.
    index("message_parent_idx").on(t.conversationId, t.parentId, t.createdAt),
    index("message_conversation_created_idx").on(t.conversationId, t.createdAt),
    index("message_run_idx").on(t.runId),
    index("message_text_search_idx").using("gin", t.textSearch),
    check("message_parent_not_self", sql`${t.parentId} <> ${t.id}`),
    check("message_role", oneOf(t.role, messageRoleSchema.options)),
    check("message_status", oneOf(t.status, messageStatusSchema.options)),
    check("message_mode", oneOf(t.mode, chatModeSchema.options)),
  ]
);

export type RunUnattended =
  | { readonly scheduleId: DotScheduleId; readonly type: "schedule" }
  | { readonly type: "check_in" };

/**
 * A chat turn (D4). Status-specific data (`afterRunId`, `approvals`, `error`,
 * `cancelledBy`, timings) sits in nullable columns; `runStateFromRow` turns a
 * row into the contract's `RunState` union.
 */
export const run = pgTable(
  "run",
  {
    /** Queued runs wait for this one (one run per branch at a time, D25). */
    afterRunId: idRef("after_run_id", "run").references(
      (): AnyPgColumn => run.id,
      { onDelete: "set null" }
    ),
    /**
     * The target was an agent's draft, not a published version (a builder
     * test run, ticket 033). Kept because the draft changes, and becomes a
     * published version, after the run.
     */
    agentDraft: boolean("agent_draft").notNull().default(false),
    /** Pending tool calls while `awaiting_approval`. */
    approvals: jsonb("approvals").$type<PendingApproval[]>(),
    /** The answer being written; `null` until the run starts. */
    assistantMessageId: idRef("assistant_message_id", "message").references(
      (): AnyPgColumn => message.id,
      { onDelete: "set null" }
    ),
    cancelledBy: idRef("cancelled_by", "user").references(() => user.id, {
      onDelete: "set null",
    }),
    contextId: contextIdRef("context_id").notNull(),
    contextType: text("context_type").$type<ChatContextType>().notNull(),
    conversationId: idRef("conversation_id", "conversation")
      .notNull()
      .references(() => conversation.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
    createdBy: idRef("created_by", "user")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    error: jsonb("error").$type<RunError>(),
    /** Which `RunExecutor` took it (`in-process`, later `worker`), for ops. */
    executor: text("executor"),
    finishedAt: instant("finished_at"),
    id: idColumn("run"),
    idempotencyKey: text("idempotency_key"),
    /** Highest chunk `seq` written; the stream cursor. */
    lastSeq: integer("last_seq").notNull().default(0),
    options: jsonb("options").$type<RunOptions>(),
    resolvedModel: text("resolved_model").$type<ModelRef>(),
    startedAt: instant("started_at"),
    status: text("status")
      .$type<(typeof runStatusSchema.options)[number]>()
      .notNull(),
    target: jsonb("target").$type<RunTarget>().notNull(),
    unattended: jsonb("unattended").$type<RunUnattended>(),
    updatedAt: updatedAt(),
    usage: jsonb("usage").$type<TokenUsage>(),
    userMessageId: idRef("user_message_id", "message")
      .notNull()
      .references((): AnyPgColumn => message.id, { onDelete: "cascade" }),
  },
  (t) => [
    index("run_conversation_idx").on(t.conversationId, t.createdAt),
    // The executor's and the queue's hot path: unfinished runs only.
    index("run_active_idx")
      .on(t.conversationId, t.createdAt)
      .where(oneOf(t.status, ACTIVE_RUN_STATUSES)),
    uniqueIndex("run_idempotency_uidx")
      .on(t.createdBy, t.idempotencyKey)
      .where(sql`${t.idempotencyKey} is not null`),
    check("run_status", oneOf(t.status, runStatusSchema.options)),
    check(
      "run_context_type",
      oneOf(t.contextType, chatContextTypeSchema.options)
    ),
    check("run_last_seq_non_negative", sql`${t.lastSeq} >= 0`),
  ]
);

/** One stored chunk of a run's stream, for resume; pruned after the run ends. */
export const runChunk = pgTable(
  "run_chunk",
  {
    createdAt: createdAt(),
    /** An AI SDK `UIMessageChunk`, kept opaque. */
    payload: jsonb("payload").$type<JsonValue>().notNull(),
    runId: idRef("run_id", "run")
      .notNull()
      .references(() => run.id, { onDelete: "cascade" }),
    seq: integer("seq").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.runId, t.seq] }),
    check("run_chunk_seq_positive", sql`${t.seq} >= 1`),
  ]
);
