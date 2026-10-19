import type { ApiClient } from "@workspace/client/api";
import { readRunStream } from "@workspace/client/run-stream";
import {
  type MessageId,
  messageIdSchema,
  type RunId,
  runIdSchema,
} from "@workspace/contract/schemas/common";
import { runStatusSchema } from "@workspace/contract/schemas/runs";
import { err, ok, type Result } from "@workspace/shared/result";
import type { UIMessageChunk } from "ai";
import { z } from "zod";

import { advanceReply, EMPTY_CURSOR } from "./sentences";

// A voice call's reply to one turn (172), as one deep call: ask with what was
// said, get the reply's sentences as they become speakable, then an explicit
// end. Everything that makes that hard lives behind it: following the run's
// stream, a run replaced by another (a retry, a second send), a stream that
// ends without text (read the stored answer instead), and cancelling the run
// when the caller stops listening. The voice engine never looks at the chat's
// status or its newest message to guess when a reply is over.

export const replyEndSchema = z.enum(["finished", "failed", "cancelled"]);
export type ReplyEnd = z.infer<typeof replyEndSchema>;

export const replyEventSchema = z.discriminatedUnion("type", [
  /** The reply's whole text so far, for the transcript. */
  z.object({ text: z.string(), type: z.literal("text") }),
  /** The next sentence to speak. */
  z.object({ sentence: z.string(), type: z.literal("sentence") }),
  /** Always last, exactly once. */
  z.object({ end: replyEndSchema, type: z.literal("end") }),
]);
export type ReplyEvent = z.infer<typeof replyEventSchema>;

export interface VoiceReplies {
  /** Aborting `signal` cancels the reply's run; the events still end. */
  readonly ask: (
    text: string,
    signal: AbortSignal
  ) => AsyncIterable<ReplyEvent>;
}

/** What the reply needs to know about a run. */
export const replyRunSchema = z.object({
  /** The stored answer, once the run has started. */
  assistantMessageId: messageIdSchema.nullable(),
  id: runIdSchema,
  status: runStatusSchema,
});
export type ReplyRun = z.infer<typeof replyRunSchema>;

/** The server, as a reply sees it. `createRunReplyPorts` is the real one. */
export interface RunReplyPorts {
  /** The stored answer's text. */
  readonly answer: (id: MessageId) => Promise<Result<string, string>>;
  readonly cancel: (id: RunId) => Promise<void>;
  readonly run: (id: RunId) => Promise<Result<ReplyRun, string>>;
  /** Sends the turn; the run that answers it. */
  readonly send: (text: string) => Promise<Result<RunId, string>>;
  /** The run's chunks until it's over (or the connection is lost for good). */
  readonly stream: (
    id: RunId,
    signal: AbortSignal
  ) => AsyncIterable<UIMessageChunk>;
  /** A newer run in the same conversation that took over from this one. */
  readonly successor: (id: RunId) => Promise<RunId | null>;
}

/** Runs followed per turn: the first and the ones that replaced it. */
const MAX_RUNS = 3;
/** Re-reads of a stream that ended while its run was still going. */
const MAX_REREADS = 3;

const TERMINAL = new Set<ReplyRun["status"]>([
  "succeeded",
  "failed",
  "cancelled",
]);

/** Text parts of a stream, in order. Pure over its inputs. */
const addChunk = (
  parts: ReadonlyMap<string, string>,
  chunk: UIMessageChunk
): ReadonlyMap<string, string> => {
  if (chunk.type === "text-start") {
    return new Map([...parts, [chunk.id, parts.get(chunk.id) ?? ""]]);
  }
  if (chunk.type === "text-delta") {
    return new Map([
      ...parts,
      [chunk.id, (parts.get(chunk.id) ?? "") + chunk.delta],
    ]);
  }
  return parts;
};

const joined = (parts: ReadonlyMap<string, string>) =>
  [...parts.values()].filter(Boolean).join("\n\n");

type Followed =
  | { readonly kind: "aborted" }
  | { readonly kind: "ended"; readonly run: ReplyRun | null };

/** Turns the reply's growing markdown into events; remembers what's out. */
const createSpeaker = () => {
  let cursor = EMPTY_CURSOR;
  let said = "";
  return {
    said: () => said,
    speak: (markdown: string, final: boolean): ReplyEvent[] => {
      const { cursor: next, sentences } = advanceReply(cursor, markdown, final);
      const grew = markdown !== said;
      cursor = next;
      said = markdown;
      return [
        ...(grew ? [{ text: markdown, type: "text" } as const] : []),
        ...sentences.map(
          (sentence) => ({ sentence, type: "sentence" }) as const
        ),
      ];
    },
  };
};
type Speaker = ReturnType<typeof createSpeaker>;

/** One read of a run's stream. */
async function* readOnce(
  ports: RunReplyPorts,
  id: RunId,
  signal: AbortSignal,
  speaker: Speaker
): AsyncGenerator<ReplyEvent> {
  let parts: ReadonlyMap<string, string> = new Map();
  try {
    for await (const chunk of ports.stream(id, signal)) {
      if (signal.aborted) {
        return;
      }
      parts = addChunk(parts, chunk);
      yield* speaker.speak(joined(parts), false);
    }
  } catch {
    // A stream lost for good: the run's status says what happened.
  }
}

/** One run, its stream re-read while the run is still going. */
async function* followRun(
  ports: RunReplyPorts,
  id: RunId,
  signal: AbortSignal,
  speaker: Speaker,
  reads = 1
): AsyncGenerator<ReplyEvent, Followed> {
  yield* readOnce(ports, id, signal, speaker);
  if (signal.aborted) {
    return { kind: "aborted" };
  }
  const run = await ports.run(id);
  if (!run.ok) {
    return { kind: "ended", run: null };
  }
  if (TERMINAL.has(run.value.status)) {
    return { kind: "ended", run: run.value };
  }
  if (reads >= MAX_REREADS) {
    return { kind: "ended", run: null };
  }
  return yield* followRun(ports, id, signal, speaker, reads + 1);
}

const end = (value: ReplyEnd): ReplyEvent => ({ end: value, type: "end" });

/** The reply from run `id` on, following whichever run replaces it. */
async function* answerFrom(
  ports: RunReplyPorts,
  id: RunId,
  signal: AbortSignal,
  speaker: Speaker,
  runsLeft: number
): AsyncGenerator<ReplyEvent> {
  const outcome = signal.aborted
    ? ({ kind: "aborted" } as const)
    : yield* followRun(ports, id, signal, speaker);
  if (outcome.kind === "aborted") {
    await ports.cancel(id);
    yield* speaker.speak(speaker.said(), true);
    yield end("cancelled");
    return;
  }
  const { run } = outcome;
  if (run?.status === "succeeded") {
    if (!speaker.said().trim() && run.assistantMessageId) {
      const stored = await ports.answer(run.assistantMessageId);
      if (stored.ok) {
        yield* speaker.speak(stored.value, false);
      }
    }
    yield* speaker.speak(speaker.said(), true);
    yield end("finished");
    return;
  }
  // Stopped or failed before saying anything: carry on with whichever run
  // took over (a retry, a second send), if any.
  const next =
    run && runsLeft > 1 && !speaker.said().trim()
      ? await ports.successor(run.id)
      : null;
  if (next) {
    yield* answerFrom(ports, next, signal, speaker, runsLeft - 1);
    return;
  }
  yield* speaker.speak(speaker.said(), true);
  yield end(run?.status === "cancelled" ? "cancelled" : "failed");
}

/**
 * The reply to `text`. Ends `finished` when its run succeeded (with whatever
 * it said, streamed or stored), `cancelled` when the run was stopped (by the
 * caller or anyone else) and nothing replaced it, `failed` otherwise.
 */
export async function* askReply(
  ports: RunReplyPorts,
  text: string,
  signal: AbortSignal
): AsyncGenerator<ReplyEvent> {
  const sent = await ports.send(text);
  if (!sent.ok) {
    yield end("failed");
    return;
  }
  yield* answerFrom(ports, sent.value, signal, createSpeaker(), MAX_RUNS);
}

/** Replies over the given ports. */
export const createVoiceReplies = (ports: RunReplyPorts): VoiceReplies => ({
  ask: (text, signal) => askReply(ports, text, signal),
});

const message = (cause: unknown) =>
  cause instanceof Error ? cause.message : String(cause);

async function* chunksOf(
  stream: ReadableStream<UIMessageChunk>
): AsyncGenerator<UIMessageChunk> {
  const reader = stream.getReader();
  try {
    for (;;) {
      // biome-ignore lint/performance/noAwaitInLoops: a stream is read in order.
      const { done, value } = await reader.read();
      if (done) {
        return;
      }
      yield value;
    }
  } finally {
    reader.cancel().catch(() => undefined);
  }
}

export interface RunReplyPortsOptions {
  /** Origin of the server; `""` for same origin. */
  readonly baseUrl?: string;
  readonly client: Pick<ApiClient, "messages" | "runs">;
  readonly fetch?: typeof fetch;
  /** Sends the turn through the chat, so it shows there; the run it started. */
  readonly send: (text: string) => Promise<RunId | null>;
}

/** The real ports: the chat sends, the API answers. */
export const createRunReplyPorts = ({
  baseUrl = "",
  client,
  fetch: doFetch,
  send,
}: RunReplyPortsOptions): RunReplyPorts => {
  const runOf = (id: RunId) => client.runs.get({ id });
  return {
    answer: (id) =>
      client.messages.get({ id }).then(
        (found) =>
          ok(
            found.parts
              .flatMap((part) => (part.type === "text" ? [part.text] : []))
              .join("\n\n")
          ),
        (cause: unknown) => err(message(cause))
      ),
    cancel: (id) =>
      client.runs.cancel({ id }).then(
        () => undefined,
        // Already over: nothing to stop.
        () => undefined
      ),
    run: (id) =>
      runOf(id).then(
        (run) =>
          ok({
            assistantMessageId: run.assistantMessageId,
            id: run.id,
            status: run.state.status,
          }),
        (cause: unknown) => err(message(cause))
      ),
    send: (text) =>
      send(text).then(
        (id) => (id ? ok(id) : err("The turn wasn't sent.")),
        (cause: unknown) => err(message(cause))
      ),
    stream: (id, signal) =>
      chunksOf(
        readRunStream(`${baseUrl}/api/runs/${id}/stream`, {
          fetch: doFetch,
          signal,
        })
      ),
    successor: async (id) => {
      try {
        const run = await runOf(id);
        const newer = await client.runs.list({
          conversationId: run.conversationId,
          limit: 5,
        });
        // Newest first: the latest run started after this one.
        const next = newer.items.find(
          (item) => item.id !== id && item.createdAt > run.createdAt
        );
        return next?.id ?? null;
      } catch {
        return null;
      }
    },
  };
};

/** One scripted reply for the fake. */
export interface FakeReply {
  readonly end: ReplyEnd;
  readonly sentences: readonly string[];
}

export interface FakeVoiceReplies extends VoiceReplies {
  /** What was asked, in order. */
  readonly asked: readonly string[];
}

/** In memory, for tests: answers each ask with the next scripted reply. */
export const createFakeVoiceReplies = (
  script: readonly FakeReply[]
): FakeVoiceReplies => {
  const asked: string[] = [];
  return {
    async *ask(text, signal) {
      const reply = script[asked.length] ?? { end: "failed", sentences: [] };
      asked.push(text);
      let said = "";
      for (const sentence of reply.sentences) {
        if (signal.aborted) {
          yield { end: "cancelled", type: "end" };
          return;
        }
        // biome-ignore lint/performance/noAwaitInLoops: sentences come in order.
        await Promise.resolve();
        said = said ? `${said} ${sentence}` : sentence;
        yield { text: said, type: "text" };
        yield { sentence, type: "sentence" };
      }
      yield { end: reply.end, type: "end" };
    },
    asked,
  };
};
