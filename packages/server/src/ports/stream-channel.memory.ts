import type { TerminalRunStatus } from "@workspace/ai/ports/run-executor";
import type { JsonValue, RunId } from "@workspace/contract/schemas/common";
import { err, ok } from "@workspace/shared/result";

import type { StreamChannel, StreamEvent } from "./stream-channel";

// In-memory StreamChannel for tests and single-process dev. Same contract as
// the Postgres adapter: ordered sequence numbers, replay from a cursor, live
// fan-out, and an `end` event after close.

interface Stream {
  chunks: { payload: JsonValue; seq: number }[];
  lastSeq: number;
  /** Resolvers for subscribers waiting on the next append or close. */
  readonly listeners: Set<() => void>;
  status: TerminalRunStatus | null;
}

export const createMemoryStreamChannel = (): StreamChannel => {
  const streams = new Map<RunId, Stream>();

  const streamFor = (runId: RunId): Stream => {
    const existing = streams.get(runId);
    if (existing) {
      return existing;
    }
    const created: Stream = {
      chunks: [],
      lastSeq: 0,
      listeners: new Set(),
      status: null,
    };
    streams.set(runId, created);
    return created;
  };

  const wake = (stream: Stream) => {
    for (const listener of [...stream.listeners]) {
      listener();
    }
  };

  async function* follow(
    stream: Stream,
    cursor: number,
    signal: AbortSignal | undefined
  ): AsyncGenerator<StreamEvent> {
    let position = cursor;
    while (!signal?.aborted) {
      const next = stream.chunks.filter((chunk) => chunk.seq > position);
      for (const chunk of next) {
        yield { payload: chunk.payload, seq: chunk.seq, type: "chunk" };
        position = chunk.seq;
      }
      // Closed and nothing left after the cursor (a pruned stream has no
      // chunks at all): the stream is over.
      if (
        stream.status &&
        !stream.chunks.some((chunk) => chunk.seq > position)
      ) {
        yield { status: stream.status, type: "end" };
        return;
      }
      if (next.length === 0) {
        // biome-ignore lint/performance/noAwaitInLoops: a subscriber waits for each append in turn.
        await new Promise<void>((resolve) => {
          const done = () => {
            stream.listeners.delete(done);
            signal?.removeEventListener("abort", done);
            resolve();
          };
          stream.listeners.add(done);
          signal?.addEventListener("abort", done, { once: true });
        });
      }
    }
  }

  return {
    append: (runId, payload) => {
      const stream = streamFor(runId);
      if (stream.status) {
        return Promise.resolve(err({ runId, type: "closed" as const }));
      }
      stream.lastSeq += 1;
      stream.chunks.push({ payload, seq: stream.lastSeq });
      wake(stream);
      return Promise.resolve(ok(stream.lastSeq));
    },

    close: (runId, status) => {
      const stream = streamFor(runId);
      stream.status ??= status;
      wake(stream);
      return Promise.resolve(ok(undefined));
    },

    prune: (runId) => {
      const stream = streams.get(runId);
      if (stream?.status) {
        stream.chunks = [];
      }
      return Promise.resolve(ok(undefined));
    },

    subscribe: (runId, options = {}) =>
      Promise.resolve(
        ok(follow(streamFor(runId), options.cursor ?? 0, options.signal))
      ),
  };
};
