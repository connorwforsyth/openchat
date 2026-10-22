import type { MessageId, RunId } from "@workspace/contract/schemas/common";
import type { UIMessageChunk } from "ai";
import { describe, expect, it } from "vitest";

import {
  askReply,
  createFakeVoiceReplies,
  type ReplyEvent,
  type ReplyRun,
  type RunReplyPorts,
} from "./reply";

const RUN_1 = "00000000-0000-7000-8000-000000000001" as RunId;
const RUN_2 = "00000000-0000-7000-8000-000000000002" as RunId;
const ANSWER = "00000000-0000-7000-8000-0000000000aa" as MessageId;

const text = (delta: string): UIMessageChunk[] => [
  { id: "t", type: "text-start" },
  { delta, id: "t", type: "text-delta" },
  { id: "t", type: "text-end" },
];

interface World {
  readonly answers?: Readonly<Record<string, string>>;
  readonly runs: Readonly<Record<string, ReplyRun>>;
  readonly sent?: RunId | null;
  readonly streams: Readonly<Record<string, readonly UIMessageChunk[]>>;
  readonly successors?: Readonly<Record<string, RunId>>;
}

const runOf = (
  id: RunId,
  status: ReplyRun["status"],
  assistantMessageId: MessageId | null = null
): ReplyRun => ({ assistantMessageId, id, status });

/** The ports, in memory: what the server would say about each run. */
const portsOf = (world: World) => {
  const cancelled: RunId[] = [];
  const ports: RunReplyPorts = {
    answer: (id) => {
      const found = world.answers?.[id];
      return Promise.resolve(
        found === undefined
          ? { error: "no answer", ok: false }
          : { ok: true, value: found }
      );
    },
    cancel: (id) => {
      cancelled.push(id);
      return Promise.resolve();
    },
    run: (id) => {
      const found = world.runs[id];
      return Promise.resolve(
        found ? { ok: true, value: found } : { error: "no run", ok: false }
      );
    },
    send: () => {
      const sent = world.sent === undefined ? RUN_1 : world.sent;
      return Promise.resolve(
        sent ? { ok: true, value: sent } : { error: "not sent", ok: false }
      );
    },
    async *stream(id) {
      for (const chunk of world.streams[id] ?? []) {
        // biome-ignore lint/performance/noAwaitInLoops: chunks arrive in order.
        await Promise.resolve();
        yield chunk;
      }
    },
    successor: (id) => Promise.resolve(world.successors?.[id] ?? null),
  };
  return { cancelled, ports };
};

const collect = async (
  events: AsyncIterable<ReplyEvent>
): Promise<ReplyEvent[]> => {
  const out: ReplyEvent[] = [];
  for await (const event of events) {
    out.push(event);
  }
  return out;
};

const spoken = (events: readonly ReplyEvent[]) =>
  events.flatMap((event) =>
    event.type === "sentence" ? [event.sentence] : []
  );

describe("askReply", () => {
  it("speaks the streamed answer, then ends finished", async () => {
    const { ports } = portsOf({
      runs: { [RUN_1]: runOf(RUN_1, "succeeded") },
      streams: { [RUN_1]: text("Two plus two equals four. Anything else?") },
    });
    const events = await collect(
      askReply(ports, "2+2?", new AbortController().signal)
    );
    expect(spoken(events)).toEqual([
      "Two plus two equals four.",
      "Anything else?",
    ]);
    expect(events.at(-1)).toEqual({ end: "finished", type: "end" });
  });

  it("reads the stored answer when the stream ends without text", async () => {
    const { ports } = portsOf({
      answers: { [ANSWER]: "2 plus 2 equals 4." },
      runs: { [RUN_1]: runOf(RUN_1, "succeeded", ANSWER) },
      streams: { [RUN_1]: [] },
    });
    const events = await collect(
      askReply(ports, "2+2?", new AbortController().signal)
    );
    expect(spoken(events)).toEqual(["2 plus 2 equals 4."]);
    expect(events.at(-1)).toEqual({ end: "finished", type: "end" });
  });

  it("follows the run that replaced a cancelled one", async () => {
    const { ports } = portsOf({
      runs: {
        [RUN_1]: runOf(RUN_1, "cancelled"),
        [RUN_2]: runOf(RUN_2, "succeeded"),
      },
      streams: { [RUN_1]: [], [RUN_2]: text("It's four.") },
      successors: { [RUN_1]: RUN_2 },
    });
    const events = await collect(
      askReply(ports, "2+2?", new AbortController().signal)
    );
    expect(spoken(events)).toEqual(["It's four."]);
    expect(events.at(-1)).toEqual({ end: "finished", type: "end" });
  });

  it("ends cancelled when the run was stopped and nothing replaced it", async () => {
    const { ports } = portsOf({
      runs: { [RUN_1]: runOf(RUN_1, "cancelled") },
      streams: { [RUN_1]: [] },
    });
    const events = await collect(
      askReply(ports, "2+2?", new AbortController().signal)
    );
    expect(events).toEqual([{ end: "cancelled", type: "end" }]);
  });

  it("ends failed when the run failed or couldn't be sent", async () => {
    const failed = portsOf({
      runs: { [RUN_1]: runOf(RUN_1, "failed") },
      streams: { [RUN_1]: [] },
    });
    expect(
      await collect(
        askReply(failed.ports, "2+2?", new AbortController().signal)
      )
    ).toEqual([{ end: "failed", type: "end" }]);
    const unsent = portsOf({ runs: {}, sent: null, streams: {} });
    expect(
      await collect(
        askReply(unsent.ports, "2+2?", new AbortController().signal)
      )
    ).toEqual([{ end: "failed", type: "end" }]);
  });

  it("cancels its run when the caller aborts", async () => {
    const { cancelled, ports } = portsOf({
      runs: { [RUN_1]: runOf(RUN_1, "running") },
      streams: { [RUN_1]: text("Hello there, friend.") },
    });
    const controller = new AbortController();
    controller.abort();
    const events = await collect(askReply(ports, "hi", controller.signal));
    expect(cancelled).toEqual([RUN_1]);
    expect(events.at(-1)).toEqual({ end: "cancelled", type: "end" });
  });

  it("never speaks the unfinished sentence after the caller aborts", async () => {
    const { cancelled, ports } = portsOf({
      runs: { [RUN_1]: runOf(RUN_1, "running") },
      streams: {
        [RUN_1]: [
          { id: "t", type: "text-start" },
          {
            delta: "The first sentence is complete. And the second",
            id: "t",
            type: "text-delta",
          },
          { delta: " never ends", id: "t", type: "text-delta" },
        ],
      },
    });
    const controller = new AbortController();
    const events: ReplyEvent[] = [];
    for await (const event of askReply(ports, "hi", controller.signal)) {
      events.push(event);
      if (event.type === "sentence") {
        controller.abort();
      }
    }
    expect(spoken(events)).toEqual(["The first sentence is complete."]);
    expect(cancelled).toEqual([RUN_1]);
    expect(events.at(-1)).toEqual({ end: "cancelled", type: "end" });
  });

  it.each(["succeeded", "failed"] as const)(
    "ends cancelled and unflushed when the caller of a %s run aborts during its lookup",
    async (status) => {
      const controller = new AbortController();
      const world = portsOf({
        runs: { [RUN_1]: runOf(RUN_1, status) },
        streams: {
          [RUN_1]: text("The first sentence is complete. And the second"),
        },
      });
      const ports: RunReplyPorts = {
        ...world.ports,
        run: (id) => {
          controller.abort();
          return world.ports.run(id);
        },
      };
      const events = await collect(askReply(ports, "hi", controller.signal));
      expect(spoken(events)).toEqual(["The first sentence is complete."]);
      expect(events.at(-1)).toEqual({ end: "cancelled", type: "end" });
    }
  );

  it("speaks nothing of the stored answer when the caller aborts while it loads", async () => {
    const controller = new AbortController();
    const world = portsOf({
      answers: { [ANSWER]: "Four. That is the answer" },
      runs: { [RUN_1]: runOf(RUN_1, "succeeded", ANSWER) },
      streams: {},
    });
    const ports: RunReplyPorts = {
      ...world.ports,
      answer: (id) => {
        controller.abort();
        return world.ports.answer(id);
      },
    };
    const events = await collect(askReply(ports, "2+2?", controller.signal));
    expect(spoken(events)).toEqual([]);
    expect(events.at(-1)).toEqual({ end: "cancelled", type: "end" });
  });

  it("reports the reply's text as it grows", async () => {
    const { ports } = portsOf({
      runs: { [RUN_1]: runOf(RUN_1, "succeeded") },
      streams: { [RUN_1]: text("Four.") },
    });
    const events = await collect(
      askReply(ports, "2+2?", new AbortController().signal)
    );
    expect(events.filter((event) => event.type === "text").at(-1)).toEqual({
      text: "Four.",
      type: "text",
    });
  });
});

describe("createFakeVoiceReplies", () => {
  it("answers each question from its script, in order", async () => {
    const replies = createFakeVoiceReplies([
      { end: "finished", sentences: ["Hello."] },
      { end: "failed", sentences: [] },
    ]);
    const { signal } = new AbortController();
    expect(spoken(await collect(replies.ask("hi", signal)))).toEqual([
      "Hello.",
    ]);
    expect((await collect(replies.ask("again", signal))).at(-1)).toEqual({
      end: "failed",
      type: "end",
    });
    expect(replies.asked).toEqual(["hi", "again"]);
  });
});
