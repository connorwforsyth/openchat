import {
  type RunStreamWriter,
  type StreamError,
  terminalRunStatusSchema,
} from "@workspace/ai/ports/run-executor";
import type { RunId } from "@workspace/contract/schemas/common";
import {
  type StreamCursor,
  streamChunkSchema,
} from "@workspace/contract/schemas/runs";
import type { AsyncResult } from "@workspace/shared/result";
import { z } from "zod";

// The StreamChannel port (D4): a run's chunks, stored so any client can
// resume from a cursor, and fanned out live to every subscriber. M1's adapter
// is Postgres (`run_chunk` rows + LISTEN/NOTIFY); Redis is an optional adapter
// later. `GET /api/runs/:id/stream` turns events into SSE: `id` is the chunk's
// `seq`, and `end` becomes `data: [DONE]`.

export const streamEventSchema = z.discriminatedUnion("type", [
  streamChunkSchema.extend({ type: z.literal("chunk") }),
  z.object({ status: terminalRunStatusSchema, type: z.literal("end") }),
]);
export type StreamEvent = z.infer<typeof streamEventSchema>;

export interface SubscribeOptions {
  /** The last `seq` the client has; replay starts after it. Omitted means from the start. */
  readonly cursor?: StreamCursor;
  /** Aborting ends the iteration (the client disconnected). */
  readonly signal?: AbortSignal;
}

export interface StreamChannel extends RunStreamWriter {
  /**
   * Drops a finished run's stored chunks (they're only for resume; the
   * message holds the result). Subscribing afterwards yields just `end`.
   */
  prune: (runId: RunId) => AsyncResult<void, StreamError>;
  /**
   * Chunks after `cursor` in order, then live ones as they're appended, then
   * one `end` event once the run's stream closes. No gaps, no repeats. A
   * subscription may start before the first chunk exists: the channel knows
   * streams, not runs, so checking the run exists is the route's job.
   */
  subscribe: (
    runId: RunId,
    options?: SubscribeOptions
  ) => AsyncResult<AsyncIterable<StreamEvent>, StreamError>;
}
