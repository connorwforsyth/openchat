import type { RunId } from "@workspace/contract/schemas/common";
import { streamCursorSchema } from "@workspace/contract/schemas/runs";

import type { StreamChannel } from "../ports/stream-channel";

// `GET /api/runs/{id}/stream` as Server-Sent Events in the AI SDK UI message
// stream protocol (contract README "The run stream"): one `UIMessageChunk`
// per event with its sequence number as the `id`, then `data: [DONE]`.

/** Headers for every SSE response (docs/decisions/0004). */
export const SSE_HEADERS = {
  "cache-control": "no-cache, no-transform",
  connection: "keep-alive",
  "content-type": "text/event-stream; charset=utf-8",
  "x-accel-buffering": "no",
  "x-vercel-ai-ui-message-stream": "v1",
} as const;

/** Keeps idle proxies from closing a stream that's waiting on an approval. */
const HEARTBEAT_MS = 15_000;

const encoder = new TextEncoder();

/**
 * The client's position: `?cursor=` wins over `Last-Event-ID` (the browser
 * sends the header on its own reconnects; an explicit cursor is a choice).
 * Anything unparseable replays from the start rather than failing: replay is
 * always safe.
 */
export const cursorFrom = (request: Request): number => {
  const query = new URL(request.url).searchParams.get("cursor");
  const header = request.headers.get("last-event-id");
  for (const raw of [query, header]) {
    if (raw !== null && raw.trim() !== "") {
      const parsed = streamCursorSchema.safeParse(Number(raw));
      if (parsed.success) {
        return parsed.data;
      }
    }
  }
  return 0;
};

/** Streams a run's events as SSE until the run ends or the client leaves. */
export const runStreamResponse = async (
  channel: StreamChannel,
  runId: RunId,
  request: Request
): Promise<Response> => {
  const controller = new AbortController();
  const abort = () => controller.abort();
  request.signal.addEventListener("abort", abort, { once: true });
  const subscribed = await channel.subscribe(runId, {
    cursor: cursorFrom(request),
    signal: controller.signal,
  });
  if (!subscribed.ok) {
    request.signal.removeEventListener("abort", abort);
    return Response.json(
      {
        code: "SERVICE_UNAVAILABLE",
        message: "The run stream is unavailable.",
      },
      { status: 503 }
    );
  }
  const events = subscribed.value[Symbol.asyncIterator]();
  let heartbeat: ReturnType<typeof setInterval> | undefined;

  const body = new ReadableStream<Uint8Array>({
    cancel: () => {
      clearInterval(heartbeat);
      controller.abort();
      events.return?.().catch(() => undefined);
    },
    pull: async (sink) => {
      const next = await events.next();
      if (next.done) {
        clearInterval(heartbeat);
        sink.close();
        return;
      }
      const event = next.value;
      if (event.type === "chunk") {
        sink.enqueue(
          encoder.encode(
            `id: ${event.seq}\ndata: ${JSON.stringify(event.payload)}\n\n`
          )
        );
        return;
      }
      clearInterval(heartbeat);
      sink.enqueue(encoder.encode("data: [DONE]\n\n"));
      sink.close();
      request.signal.removeEventListener("abort", abort);
    },
    start: (sink) => {
      heartbeat = setInterval(() => {
        try {
          sink.enqueue(encoder.encode(": keep-alive\n\n"));
        } catch {
          clearInterval(heartbeat);
        }
      }, HEARTBEAT_MS);
    },
  });

  return new Response(body, { headers: SSE_HEADERS });
};
