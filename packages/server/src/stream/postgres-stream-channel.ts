import type {
  StreamError,
  TerminalRunStatus,
} from "@workspace/ai/ports/run-executor";
import type { JsonValue, RunId } from "@workspace/contract/schemas/common";
import type { Db } from "@workspace/db/client";
import {
  appendRunChunks,
  getRun,
  pruneRunChunks,
  readRunChunks,
} from "@workspace/db/queries/runs";
import { err, ok, type Result } from "@workspace/shared/result";
import { sql } from "drizzle-orm";

import type { StreamChannel, StreamEvent } from "../ports/stream-channel";
import { isTerminal } from "../runs/state";
import type { Listen } from "./listen";

// The StreamChannel on Postgres (D4): chunks live in `run_chunk` with gapless
// sequence numbers, and a NOTIFY per write wakes subscribers in every process.
//
// The run row is the stream's end marker: once a run is terminal its stream
// is over, so `close` must follow the run's terminal transition (the executor
// does both, in that order). A subscriber drains the chunks, sees the
// terminal status, drains once more for chunks that landed in between, then
// ends. That makes replay-then-follow gap-free without a lock.
//
// Writes are batched per run: appends made while a write is in flight go out
// together in the next one, so a fast token stream costs a transaction per
// batch rather than per token.

/** The NOTIFY channel; the payload is the run id. */
export const RUN_STREAM_CHANNEL = "run_stream";

const READ_BATCH = 500;

export interface PostgresStreamChannelOptions {
  readonly db: Db;
  /** LISTEN for live fan-out. Without it subscribers poll, which only tests should do. */
  readonly listen?: Listen;
  /**
   * Re-check this often even with LISTEN: a notification lost to a dropped
   * connection costs at most this much latency, never a stuck stream.
   */
  readonly pollIntervalMs?: number;
}

export interface PostgresStreamChannel extends StreamChannel {
  /** Stops listening. Open subscriptions fall back to polling. */
  readonly stop: () => Promise<void>;
}

interface PendingAppend {
  readonly payload: JsonValue;
  readonly resolve: (result: Result<number, StreamError>) => void;
}

interface WriteQueue {
  flushing: boolean;
  readonly pending: PendingAppend[];
}

const unavailable = (cause: unknown): StreamError => ({
  message: cause instanceof Error ? cause.message : String(cause),
  type: "unavailable",
});

export const createPostgresStreamChannel = ({
  db,
  listen,
  pollIntervalMs = listen ? 2000 : 100,
}: PostgresStreamChannelOptions): PostgresStreamChannel => {
  const queues = new Map<RunId, WriteQueue>();
  const wakers = new Map<RunId, Set<() => void>>();
  let listening: Promise<(() => Promise<void>) | null> | null = null;

  const wake = (runId: RunId) => {
    for (const waker of [...(wakers.get(runId) ?? [])]) {
      waker();
    }
  };

  const ensureListening = () => {
    if (!listen) {
      return;
    }
    listening ??= listen(RUN_STREAM_CHANNEL, (payload) =>
      wake(payload as RunId)
    ).catch(() => {
      // Can't LISTEN (say, a pooler in transaction mode): polling covers it.
      listening = null;
      return null;
    });
  };

  const terminalStatus = async (
    runId: RunId
  ): Promise<TerminalRunStatus | null> => {
    const found = await getRun(db, runId);
    return found.ok && isTerminal(found.value.status)
      ? found.value.status
      : null;
  };

  const notify = async (runId: RunId) => {
    await db.execute(sql`select pg_notify(${RUN_STREAM_CHANNEL}, ${runId})`);
    // Local subscribers don't wait for the round trip through Postgres.
    wake(runId);
  };

  const writeBatch = async (runId: RunId, batch: readonly PendingAppend[]) => {
    try {
      if (await terminalStatus(runId)) {
        for (const item of batch) {
          item.resolve(err({ runId, type: "closed" }));
        }
        return;
      }
      const written = await appendRunChunks(
        db,
        runId,
        batch.map((item) => item.payload)
      );
      if (!written.ok) {
        for (const item of batch) {
          item.resolve(
            err({ message: `no run ${runId}`, type: "unavailable" })
          );
        }
        return;
      }
      const first = written.value - batch.length + 1;
      for (const [index, item] of batch.entries()) {
        item.resolve(ok(first + index));
      }
      await notify(runId);
    } catch (cause) {
      for (const item of batch) {
        item.resolve(err(unavailable(cause)));
      }
    }
  };

  const flush = async (runId: RunId, queue: WriteQueue) => {
    queue.flushing = true;
    // Let the appends made in this tick join the first batch.
    await Promise.resolve();
    while (queue.pending.length > 0) {
      // biome-ignore lint/performance/noAwaitInLoops: batches go out in order, one at a time, so sequence numbers follow call order.
      await writeBatch(runId, queue.pending.splice(0));
    }
    queue.flushing = false;
    queues.delete(runId);
  };

  async function* follow(
    runId: RunId,
    cursor: number,
    signal: AbortSignal | undefined
  ): AsyncGenerator<StreamEvent> {
    let position = cursor;
    let dirty = false;
    let resolveWait: (() => void) | null = null;
    const waker = () => {
      dirty = true;
      resolveWait?.();
    };
    const set = wakers.get(runId) ?? new Set();
    set.add(waker);
    wakers.set(runId, set);
    ensureListening();
    const onAbort = () => resolveWait?.();
    signal?.addEventListener("abort", onAbort, { once: true });

    const drain = async function* (): AsyncGenerator<StreamEvent, number> {
      let read = 0;
      for (;;) {
        // biome-ignore lint/performance/noAwaitInLoops: pages are read in order from the cursor.
        const chunks = await readRunChunks(db, runId, {
          after: position,
          limit: READ_BATCH,
        });
        for (const chunk of chunks) {
          yield { payload: chunk.payload, seq: chunk.seq, type: "chunk" };
          position = chunk.seq;
        }
        read += chunks.length;
        if (chunks.length < READ_BATCH || signal?.aborted) {
          return read;
        }
      }
    };

    try {
      while (!signal?.aborted) {
        dirty = false;
        const read = yield* drain();
        // biome-ignore lint/performance/noAwaitInLoops: each pass checks the run after reading its chunks.
        const status = await terminalStatus(runId);
        if (status) {
          // Chunks committed before the terminal transition but after the
          // read above are still ahead of the cursor.
          yield* drain();
          yield { status, type: "end" };
          return;
        }
        if (read === 0 && !dirty && !signal?.aborted) {
          await new Promise<void>((resolve) => {
            const timer = setTimeout(resolve, pollIntervalMs);
            resolveWait = () => {
              clearTimeout(timer);
              resolve();
            };
          });
          resolveWait = null;
        }
      }
    } finally {
      signal?.removeEventListener("abort", onAbort);
      set.delete(waker);
      if (set.size === 0) {
        wakers.delete(runId);
      }
    }
  }

  return {
    append: (runId, payload) =>
      new Promise((resolve) => {
        const queue = queues.get(runId) ?? { flushing: false, pending: [] };
        queues.set(runId, queue);
        queue.pending.push({ payload, resolve });
        if (!queue.flushing) {
          flush(runId, queue).catch(() => undefined);
        }
      }),

    close: async (runId) => {
      try {
        const found = await getRun(db, runId);
        if (!found.ok) {
          return err({ message: `no run ${runId}`, type: "unavailable" });
        }
        if (!isTerminal(found.value.status)) {
          return err({
            message: "close the stream after the run's terminal transition",
            type: "unavailable",
          });
        }
        await notify(runId);
        return ok(undefined);
      } catch (cause) {
        return err(unavailable(cause));
      }
    },

    prune: async (runId) => {
      try {
        if (await terminalStatus(runId)) {
          await pruneRunChunks(db, runId);
        }
        return ok(undefined);
      } catch (cause) {
        return err(unavailable(cause));
      }
    },

    stop: async () => {
      const unlisten = await listening;
      listening = null;
      await unlisten?.();
    },

    subscribe: (runId, options = {}) =>
      Promise.resolve(ok(follow(runId, options.cursor ?? 0, options.signal))),
  };
};
