import { type SseEvent, splitSse } from "@workspace/client/run-stream";
import type { UIMessageChunk } from "ai";

// One connection to a run's stream, read by hand: what a page that just
// loaded (or a second tab) gets, with each chunk's sequence number. The
// harness follows its own runs with the app's client (`readRunStream`);
// this is for looking at the wire itself.

export interface SequencedStream {
  readonly chunks: readonly UIMessageChunk[];
  /** The stream ended with `[DONE]`. */
  readonly done: boolean;
  /** Why the stream broke, if it did. */
  readonly error: string | null;
  /** Each chunk's sequence number, as the stream's event ids give them. */
  readonly seqs: readonly number[];
  /** The HTTP status the stream answered with. */
  readonly status: number;
}

const DONE = "[DONE]";

interface Collected {
  readonly chunks: UIMessageChunk[];
  done: boolean;
  readonly seqs: number[];
}

const collect = (events: readonly SseEvent[], into: Collected) => {
  for (const event of events) {
    if (event.data === DONE) {
      into.done = true;
      return;
    }
    into.chunks.push(JSON.parse(event.data) as UIMessageChunk);
    if (event.id !== null) {
      into.seqs.push(event.id);
    }
  }
};

/**
 * Reads `response` until `[DONE]`, or until it has delivered sequence
 * number `upTo`: a run that's still going never sends `[DONE]`, so a
 * reader that only wants what exists so far stops there.
 */
export const readSequenced = async (
  response: Response,
  { cursor, upTo }: { readonly cursor: number; readonly upTo: number }
): Promise<SequencedStream> => {
  const collected: Collected = { chunks: [], done: false, seqs: [] };
  const view = (error: string | null): SequencedStream => ({
    chunks: collected.chunks,
    done: collected.done,
    error,
    seqs: collected.seqs,
    status: response.status,
  });
  const reader = response.body?.getReader();
  if (!(response.ok && reader)) {
    await response.body?.cancel().catch(() => undefined);
    return view(`the stream answered ${response.status}`);
  }
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (!collected.done && (collected.seqs.at(-1) ?? cursor) < upTo) {
      // biome-ignore lint/performance/noAwaitInLoops: a body is read in order.
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      const { events, rest } = splitSse(buffer);
      buffer = rest;
      collect(events, collected);
    }
  } catch (cause) {
    return view(cause instanceof Error ? cause.message : String(cause));
  }
  await reader.cancel().catch(() => undefined);
  return view(null);
};
