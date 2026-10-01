import { z } from "zod";

import {
  conversationIdSchema,
  jsonValueSchema,
  libraryItemIdSchema,
  libraryVersionIdSchema,
  messageIdSchema,
  runIdSchema,
  timestampSchema,
  userIdSchema,
} from "./common";
import {
  approvalDecisionSchema,
  toolNameSchema,
  userMessagePartSchema,
} from "./message-parts";
import {
  modelParametersSchema,
  modelRefSchema,
  modelSelectorSchema,
  tokenUsageSchema,
} from "./models";
import { chatContextSchema } from "./tenancy";

// A chat turn is a run (D4): `runs.create` persists the user message, returns
// `{ runId, streamUrl }` at once, and the run executes detached from the
// request. Clients stream `GET /api/runs/{id}/stream` (SSE, the AI SDK UI
// message stream protocol) and resume from a cursor. One run per branch at a
// time: a second prompt on a busy branch is `queued`.

export const runStatusSchema = z.enum([
  "queued",
  "running",
  "awaiting_approval",
  "succeeded",
  "failed",
  "cancelled",
]);
export type RunStatus = z.infer<typeof runStatusSchema>;

export const terminalRunStatuses = [
  "succeeded",
  "failed",
  "cancelled",
] as const satisfies readonly RunStatus[];

export const isTerminalRunStatus = (status: RunStatus): boolean =>
  (terminalRunStatuses as readonly RunStatus[]).includes(status);

/** One hunk of a proposed edit, as the reviewer sees it (unified-diff ranges). */
export const proposedHunkSchema = z.object({
  hunkId: z.string().min(1).max(128),
  newLines: z.int().min(0),
  newStart: z.int().min(0),
  oldLines: z.int().min(0),
  oldStart: z.int().min(0),
});

/** A write/edit tool's proposed change to one file, for per-hunk review (D16). */
export const proposedEditSchema = z.object({
  hunks: z.array(proposedHunkSchema).min(1),
  /** Unified diff of the whole change. */
  patch: z.string(),
  path: z.string().min(1),
});
export type ProposedEdit = z.infer<typeof proposedEditSchema>;

/** A tool call waiting on a human. */
export const pendingApprovalSchema = z.object({
  /** Present for write/edit tools; enables the `review` decision. */
  edits: z.array(proposedEditSchema).optional(),
  input: jsonValueSchema,
  requestedAt: timestampSchema,
  toolCallId: z.string().min(1).max(256),
  toolName: toolNameSchema,
});
export type PendingApproval = z.infer<typeof pendingApprovalSchema>;

export const runErrorCodeSchema = z.enum([
  "provider_error",
  "provider_unavailable",
  "rate_limited",
  "budget_exceeded",
  "context_too_long",
  "tool_error",
  "timeout",
  "internal",
]);

export const runErrorSchema = z.object({
  code: runErrorCodeSchema,
  /** Safe to show; never contains keys or provider response bodies. */
  message: z.string(),
  retryable: z.boolean(),
});
export type RunError = z.infer<typeof runErrorSchema>;

/** A run's status with the data that only makes sense in that status. */
export const runStateSchema = z.discriminatedUnion("status", [
  z.object({
    /** The run this one waits for (the branch's active or previous queued run). */
    afterRunId: runIdSchema,
    /** 1 means next. */
    position: z.int().min(1),
    status: z.literal("queued"),
  }),
  z.object({ startedAt: timestampSchema, status: z.literal("running") }),
  z.object({
    approvals: z.array(pendingApprovalSchema).min(1),
    startedAt: timestampSchema,
    status: z.literal("awaiting_approval"),
  }),
  z.object({
    finishedAt: timestampSchema,
    startedAt: timestampSchema,
    status: z.literal("succeeded"),
  }),
  z.object({
    error: runErrorSchema,
    finishedAt: timestampSchema,
    /** `null` if it failed before starting (say, no provider key). */
    startedAt: timestampSchema.nullable(),
    status: z.literal("failed"),
  }),
  z.object({
    /** `null` when the system cancelled it (shutdown, timeout of a queued run). */
    cancelledBy: userIdSchema.nullable(),
    finishedAt: timestampSchema,
    status: z.literal("cancelled"),
  }),
]);
export type RunState = z.infer<typeof runStateSchema>;

/** What answers: an agent (latest published version unless pinned), or a model. */
export const runTargetSchema = z.discriminatedUnion("type", [
  z.object({
    id: libraryItemIdSchema,
    type: z.literal("agent"),
    /** Pin a published version; omitted means the latest published one. */
    versionId: libraryVersionIdSchema.optional(),
  }),
  z.object({
    model: modelSelectorSchema,
    parameters: modelParametersSchema.optional(),
    type: z.literal("model"),
  }),
]);
export type RunTarget = z.infer<typeof runTargetSchema>;

const toggleSchema = z.enum(["auto", "on", "off"]);

/**
 * How hard a reasoning model thinks this turn (105), from the composer's
 * thinking control. The server maps it to the provider's own setting (a
 * thinking budget, an effort, a thinking level) and drops a level the model
 * doesn't take. Wider than `reasoningEffort`: some providers go below low
 * (`minimal`) or above high (`xhigh`, `max`).
 */
export const reasoningLevelSchema = z.enum([
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
]);
export type ReasoningLevel = z.infer<typeof reasoningLevelSchema>;

/**
 * Per-turn switches from the composer. `auto` lets the Decider and agent
 * config choose; an absent field leaves the provider's default. (Plan mode,
 * 106, adds a `mode` here.)
 */
export const runOptionsSchema = z.object({
  /**
   * The provider's fast tier for this turn (105), where the model has one
   * (OpenAI's priority processing, Anthropic's fast mode). Ignored where it
   * doesn't. A catalog's separate `-fast` model is picked as a target instead.
   */
  fast: z.boolean().optional(),
  /** The thinking level (105); wins over `reasoningEffort` when both are set. */
  reasoning: reasoningLevelSchema.optional(),
  /** The older, narrower level; prefer `reasoning`. */
  reasoningEffort: modelParametersSchema.shape.reasoningEffort,
  /**
   * The chat's file tools (the Files workspace, 055). `auto` gives them to
   * every turn whenever the instance has sandboxes enabled, creating the
   * workspace on first use, so a plain chat never needs a "create" step
   * first. `on` means the same and stays for older clients; `off` withholds
   * them for this turn.
   */
  sandbox: toggleSchema.default("auto"),
  webSearch: toggleSchema.default("auto"),
});
export type RunOptions = z.infer<typeof runOptionsSchema>;

export const runSchema = z.object({
  /** The answer being written; `null` until the run starts. */
  assistantMessageId: messageIdSchema.nullable(),
  context: chatContextSchema,
  conversationId: conversationIdSchema,
  createdAt: timestampSchema,
  createdBy: userIdSchema,
  id: runIdSchema,
  /** Highest stream sequence number written so far; resume with a smaller cursor. */
  lastSeq: z.int().min(0),
  /**
   * The switches it was asked to run with (105): its thinking level, fast
   * mode, web search. Absent from servers before 105.
   */
  options: runOptionsSchema.optional(),
  /** The concrete model once routing (aliases, `auto`) is resolved. */
  resolvedModel: modelRefSchema.nullable(),
  state: runStateSchema,
  target: runTargetSchema,
  updatedAt: timestampSchema,
  usage: tokenUsageSchema.nullable(),
  /** The user message this run answers. */
  userMessageId: messageIdSchema,
});
export type Run = z.infer<typeof runSchema>;

/**
 * What the turn is. `message` adds a user message under `parentId` (`null` for
 * the first message; editing a message is a new sibling under the same
 * parent). `regenerate` answers an existing user message again, adding a
 * sibling assistant message.
 */
export const runInputSchema = z.discriminatedUnion("type", [
  z.object({
    parentId: messageIdSchema.nullable(),
    parts: z.array(userMessagePartSchema).min(1).max(100),
    type: z.literal("message"),
  }),
  z.object({ type: z.literal("regenerate"), userMessageId: messageIdSchema }),
]);
export type RunInput = z.infer<typeof runInputSchema>;

export const createRunInputSchema = z.object({
  /**
   * Sets the chat context if the conversation is still unlocked. A different
   * context on a locked conversation is a `CONFLICT` (`context_locked`).
   */
  context: chatContextSchema.optional(),
  conversationId: conversationIdSchema,
  /** Retrying with the same key returns the first run instead of starting another. */
  idempotencyKey: z.string().min(8).max(128).optional(),
  input: runInputSchema,
  options: runOptionsSchema.optional(),
  /** Omitted means the conversation's default agent or model. */
  target: runTargetSchema.optional(),
});
export type CreateRunInput = z.infer<typeof createRunInputSchema>;

/** A same-origin path (`/api/runs/…/stream`) or an absolute URL, if streams move to a worker. */
export const streamUrlSchema = z
  .string()
  .regex(/^(?:\/|https?:\/\/)\S+$/, "a path or an http(s) URL");

export const createRunOutputSchema = z.object({
  conversationId: conversationIdSchema,
  runId: runIdSchema,
  status: runStatusSchema,
  streamUrl: streamUrlSchema,
  /** The new user message, or the one being regenerated. */
  userMessageId: messageIdSchema,
});
export type CreateRunOutput = z.infer<typeof createRunOutputSchema>;

export const toolApprovalSchema = z.object({
  decision: approvalDecisionSchema,
  toolCallId: z.string().min(1).max(256),
});
export type ToolApproval = z.infer<typeof toolApprovalSchema>;

/** Any editor of the conversation may decide (D25). Undecided calls stay pending. */
export const submitApprovalsInputSchema = z.object({
  decisions: z.array(toolApprovalSchema).min(1).max(100),
  runId: runIdSchema,
});
export type SubmitApprovalsInput = z.infer<typeof submitApprovalsInputSchema>;

/**
 * Stream position: the last sequence number the client has. `0` (or no
 * cursor) replays from the start. Sent as `?cursor=` or `Last-Event-ID`.
 */
export const streamCursorSchema = z.int().min(0);
export type StreamCursor = z.infer<typeof streamCursorSchema>;

/**
 * One stored chunk of a run's stream (`run_chunk`). `payload` is an AI SDK
 * `UIMessageChunk`, kept opaque here so the contract doesn't pin the SDK.
 */
export const streamChunkSchema = z.object({
  payload: jsonValueSchema,
  seq: z.int().min(1),
});
export type StreamChunk = z.infer<typeof streamChunkSchema>;
