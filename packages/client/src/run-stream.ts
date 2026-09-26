import type { UIMessageChunk } from "ai";

// Reads a run's stream (`GET /api/runs/{id}/stream`, contract README "The
// run stream") and survives dropped connections: every event's `id` is its
// sequence number, so a reconnect asks for `?cursor=<last id>` and the
// server replays exactly what's missing. The result is one ReadableStream of
// UI message chunks, the shape `useChat` consumes, that ends at `[DONE]`.

export interface RunStreamOptions {
  /** Resume after this sequence number; 0 replays from the start. */
  readonly cursor?: number;
  readonly fetch?: typeof fetch;
  readonly headers?: () =>
    | Record<string, string>
    | Promise<Record<string, string>>;
  /** Reconnects in a row before giving up; a successful read resets the count. */
  readonly maxRetries?: number;
  /** Told the new cursor after every chunk (to persist it, or reconnect later). */
  readonly onCursor?: (cursor: number) => void;
  /** Delay before reconnect attempt `n` (from 1). */
  readonly retryDelayMs?: (attempt: number) => number;
  readonly signal?: AbortSignal;
}

const LEADING_SPACE = /^ /;

export interface SseEvent {
  readonly data: string;
  readonly id: number | null;
}

/** Splits SSE text into complete events and the unfinished remainder. Pure. */
export const splitSse = (
  buffer: string
): { readonly events: SseEvent[]; readonly rest: string } => {
  const normalized = buffer.replaceAll("\r\n", "\n");
  const blocks = normalized.split("\n\n");
  const rest = blocks.pop() ?? "";
  const events = blocks.flatMap((block): SseEvent[] => {
    let id: number | null = null;
    const data: string[] = [];
    for (const line of block.split("\n")) {
      if (line.startsWith("id:")) {
        const parsed = Number(line.slice(3).trim());
        id = Number.isSafeInteger(parsed) ? parsed : null;
      } else if (line.startsWith("data:")) {
        data.push(line.slice(5).replace(LEADING_SPACE, ""));
      }
    }
    // Comments (`: keep-alive`) and empty blocks carry no data.
    return data.length > 0 ? [{ data: data.join("\n"), id }] : [];
  });
  return { events, rest };
};

const DONE = "[DONE]";

const defaultDelay = (attempt: number) =>
  Math.min(250 * 2 ** (attempt - 1), 5000);

const wait = (ms: number, signal: AbortSignal | undefined) =>
  new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true }
    );
  });

/**
 * Why the stream stopped for good: the server said no (`status` is the 4xx),
 * or retries ran out (`status` is `null`).
 */
export interface RunStreamError extends Error {
  readonly runStream: true;
  readonly status: number | null;
}

const runStreamError = (
  message: string,
  status: number | null
): RunStreamError =>
  Object.assign(new Error(message), {
    name: "RunStreamError",
    runStream: true as const,
    status,
  });

export const isRunStreamError = (error: unknown): error is RunStreamError =>
  error instanceof Error &&
  (error as Partial<RunStreamError>).runStream === true;

const withCursor = (url: string, cursor: number): string => {
  const [path = "", query = ""] = url.split("?");
  const params = new URLSearchParams(query);
  params.set("cursor", String(cursor));
  return `${path}?${params.toString()}`;
};

/** Parsed SSE events from a response body, as they arrive. */
async function* sseEvents(
  reader: ReadableStreamDefaultReader<Uint8Array>
): AsyncGenerator<SseEvent> {
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    // biome-ignore lint/performance/noAwaitInLoops: a body is read in order.
    const { done, value } = await reader.read();
    if (done) {
      return;
    }
    buffer += decoder.decode(value, { stream: true });
    const { events, rest } = splitSse(buffer);
    buffer = rest;
    yield* events;
  }
}

const RETRYABLE_STATUS = (status: number) => status >= 500 || status === 429;

/** How one connection ended. */
type Attempt = "done" | "dropped";

/**
 * One run's chunks as a stream, reconnecting from the last cursor when the
 * connection drops. Errors only on a non-retryable answer (4xx) or after
 * `maxRetries` failed reconnects in a row.
 */
export const readRunStream = (
  url: string,
  options: RunStreamOptions = {}
): ReadableStream<UIMessageChunk> => {
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const maxRetries = options.maxRetries ?? 5;
  const delay = options.retryDelayMs ?? defaultDelay;
  let cursor = options.cursor ?? 0;
  const internal = new AbortController();
  const signal = options.signal
    ? AbortSignal.any([options.signal, internal.signal])
    : internal.signal;

  const open = async (): Promise<ReadableStreamDefaultReader<Uint8Array>> => {
    const response = await fetchImpl(withCursor(url, cursor), {
      credentials: "include",
      headers: {
        accept: "text/event-stream",
        ...(await options.headers?.()),
      },
      signal,
    });
    if (!response.ok) {
      throw runStreamError(
        `The run stream answered ${response.status}.`,
        RETRYABLE_STATUS(response.status) ? null : response.status
      );
    }
    const reader = response.body?.getReader();
    if (!reader) {
      throw runStreamError("The run stream has no body.", null);
    }
    return reader;
  };

  /** Streams one connection's chunks into `sink` until `[DONE]` or a drop. */
  const connect = async (
    sink: ReadableStreamDefaultController<UIMessageChunk>
  ): Promise<Attempt> => {
    const reader = await open();
    for await (const event of sseEvents(reader)) {
      if (event.data === DONE) {
        await reader.cancel().catch(() => undefined);
        return "done";
      }
      // Chunks at or before the cursor were already delivered.
      if (event.id === null || event.id > cursor) {
        sink.enqueue(JSON.parse(event.data) as UIMessageChunk);
        if (event.id !== null) {
          cursor = event.id;
          options.onCursor?.(cursor);
        }
      }
    }
    return "dropped";
  };

  /** A connection attempt; a thrown error that isn't fatal counts as a drop. */
  const attempt = async (
    sink: ReadableStreamDefaultController<UIMessageChunk>
  ): Promise<Attempt> => {
    try {
      return await connect(sink);
    } catch (cause) {
      if (isRunStreamError(cause) && cause.status !== null) {
        throw cause;
      }
      return "dropped";
    }
  };

  return new ReadableStream<UIMessageChunk>({
    cancel: () => internal.abort(),
    start: async (sink) => {
      let failures = 0;
      try {
        while (!signal.aborted) {
          const before = cursor;
          // biome-ignore lint/performance/noAwaitInLoops: one connection at a time, resuming where the last left off.
          if ((await attempt(sink)) === "done") {
            break;
          }
          // A connection that delivered something resets the count.
          failures = cursor > before ? 1 : failures + 1;
          if (failures > maxRetries) {
            throw runStreamError(
              "Lost the run stream and couldn't get it back.",
              null
            );
          }
          await wait(delay(failures), signal);
        }
        sink.close();
      } catch (cause) {
        sink.error(cause);
      }
    },
  });
};
