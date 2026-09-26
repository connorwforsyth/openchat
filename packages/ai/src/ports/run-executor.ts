import {
  conversationIdSchema,
  type JsonValue,
  messageIdSchema,
  type RunId,
  runIdSchema,
  type UserId,
  userIdSchema,
} from "@workspace/contract/schemas/common";
import {
  type RunState,
  runOptionsSchema,
  runStatusSchema,
  runTargetSchema,
  type ToolApproval,
} from "@workspace/contract/schemas/runs";
import { chatContextSchema } from "@workspace/contract/schemas/tenancy";
import type { AsyncResult } from "@workspace/shared/result";
import { z } from "zod";

// The RunExecutor port (D4, PLAN.md §8 "Chat run"). A run executes detached
// from the request that created it: `start` returns once the run is accepted,
// and output goes to a `RunStreamWriter` that clients read through the
// server's `StreamChannel`. M1 runs it in-process inside `web`; the
// Collaboration wave moves it to `apps/worker` behind this same interface.

/** Everything the executor needs to run a turn. Serializable, so it can travel through a job queue. */
export const runStartSchema = z.object({
  context: chatContextSchema,
  conversationId: conversationIdSchema,
  createdBy: userIdSchema,
  options: runOptionsSchema.prefault({}),
  runId: runIdSchema,
  target: runTargetSchema,
  /** The user message this run answers; the branch is the path to it. */
  userMessageId: messageIdSchema,
});
export type RunStart = z.infer<typeof runStartSchema>;

export const terminalRunStatusSchema = runStatusSchema.extract([
  "succeeded",
  "failed",
  "cancelled",
]);
export type TerminalRunStatus = z.infer<typeof terminalRunStatusSchema>;

export const streamErrorSchema = z.discriminatedUnion("type", [
  /** The run's stream already ended; nothing more can be written. */
  z.object({ runId: runIdSchema, type: z.literal("closed") }),
  z.object({ message: z.string(), type: z.literal("unavailable") }),
]);
export type StreamError = z.infer<typeof streamErrorSchema>;

/**
 * The write half of a run's stream. The server's `StreamChannel` extends it
 * with `subscribe`; the executor only ever needs this half, which keeps
 * `@workspace/ai` free of any dependency on the server.
 */
export interface RunStreamWriter {
  /**
   * Appends one AI SDK `UIMessageChunk` (as JSON) to the run's stream and
   * returns its sequence number (1, 2, 3…). Order is the call order.
   */
  append: (
    runId: RunId,
    payload: JsonValue
  ) => AsyncResult<number, StreamError>;
  /** Ends the stream; subscribers receive the end event and stop. Idempotent. */
  close: (
    runId: RunId,
    status: TerminalRunStatus
  ) => AsyncResult<void, StreamError>;
}

export const runExecutorErrorSchema = z.discriminatedUnion("type", [
  z.object({ runId: runIdSchema, type: z.literal("not_found") }),
  /** The run exists but can't take this action now (say, approving a finished run). */
  z.object({
    runId: runIdSchema,
    status: runStatusSchema,
    type: z.literal("invalid_state"),
  }),
  z.object({ runId: runIdSchema, type: z.literal("already_started") }),
  /** A decision named a tool call the run isn't waiting on. */
  z.object({
    runId: runIdSchema,
    toolCallId: z.string(),
    type: z.literal("unknown_tool_call"),
  }),
  z.object({ message: z.string(), type: z.literal("unavailable") }),
]);
export type RunExecutorError = z.infer<typeof runExecutorErrorSchema>;

export interface RunExecutor {
  /**
   * Cancels a queued, running or waiting run. Its stream closes as
   * `cancelled`. `by` is `null` when the system cancels (shutdown, timeout).
   */
  cancel: (
    runId: RunId,
    by: UserId | null
  ) => AsyncResult<void, RunExecutorError>;
  /** The run's current state. */
  getState: (runId: RunId) => AsyncResult<RunState, RunExecutorError>;
  /**
   * Accepts a run and returns without waiting for it. The executor owns every
   * state change from here: running, awaiting approval, and a terminal state.
   */
  start: (run: RunStart) => AsyncResult<void, RunExecutorError>;
  /**
   * Resolves pending tool calls. The run resumes once every pending call has
   * a decision; `invalid_state` unless the run is `awaiting_approval`.
   */
  submitApprovals: (
    runId: RunId,
    decisions: readonly ToolApproval[],
    by: UserId
  ) => AsyncResult<void, RunExecutorError>;
}
