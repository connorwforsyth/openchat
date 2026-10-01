import { textStream } from "@workspace/ai/testing/mock-models";
import type { Conversation } from "@workspace/contract/schemas/conversations";
import type { CreateRunOutput } from "@workspace/contract/schemas/runs";
import { MockLanguageModelV4 } from "ai/test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createHarness, type Harness, readEvents } from "../testing/harness";
import { pendingMarks, type RunMark } from "./timing";

// Ticket 102: a run marks each phase on its way to the first token, in
// order, when the shell gives it somewhere to put them.

let h: Harness;
let marks: RunMark[];

beforeEach(async () => {
  marks = [];
  h = await createHarness({
    models: {
      "test:model": new MockLanguageModelV4({
        doStream: () => Promise.resolve(textStream("Hi there")),
      }),
    },
    realTurns: true,
    timings: (mark) => {
      marks.push(mark);
    },
  });
});

afterEach(() => h.close());

describe("run timing marks", () => {
  it("marks a plain chat's phases, in order, up to the first text", async () => {
    const conversation = (await (
      await h.request("/api/conversations", { json: {}, method: "POST" })
    ).json()) as Conversation;
    const created = (await (
      await h.request("/api/runs", {
        json: {
          conversationId: conversation.id,
          input: {
            parentId: null,
            parts: [{ text: "Hello", type: "text" }],
            type: "message",
          },
          target: { model: "test:model", type: "model" },
        },
        method: "POST",
      })
    ).json()) as CreateRunOutput;
    await readEvents(await h.request(created.streamUrl));

    const own = marks.filter((mark) => mark.runId === created.runId);
    const run = own.filter((mark) => mark.phase !== "stream.opened");
    expect(run.map((mark) => mark.phase)).toEqual([
      "run.received",
      "run.checked",
      "run.placed",
      "run.started",
      "turn.branch",
      "turn.model",
      "turn.gate",
      "turn.workspace",
      "turn.mentions",
      "turn.resolved",
      "agent.called",
      "agent.first-text",
    ]);
    const times = run.map((mark) => mark.at);
    expect(times).toEqual([...times].sort((a, b) => a - b));
    expect(own.some((mark) => mark.phase === "stream.opened")).toBe(true);
  });
});

describe("pendingMarks", () => {
  it("holds marks until the run has an id, keeping when they were taken", () => {
    const seen: RunMark[] = [];
    const pending = pendingMarks((mark) => seen.push(mark));
    pending.mark("run.received");
    expect(seen).toEqual([]);
    const runId = "01a0f54d-734d-7103-bca4-e9afef24a246" as RunMark["runId"];
    pending.flush(runId);
    expect(seen).toEqual([
      { at: expect.any(Number), phase: "run.received", runId },
    ]);
  });

  it("records nothing without a sink", () => {
    const pending = pendingMarks(undefined);
    pending.mark("run.received");
    expect(() =>
      pending.flush("01a0f54d-734d-7103-bca4-e9afef24a246" as RunMark["runId"])
    ).not.toThrow();
  });
});
