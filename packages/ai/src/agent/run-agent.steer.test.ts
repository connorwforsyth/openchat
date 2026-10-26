import { newId } from "@workspace/shared/ids";
import { tool, type UIMessage } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { STEER_DATA, type SteerData } from "../messages/steer";
import { readAll, textStream, toolCallStream } from "../testing/mock-models";
import { runAgent, type TakenSteer, withSteers } from "./run-agent";

const user = (id: string, text: string): UIMessage => ({
  id,
  parts: [{ text, type: "text" }],
  role: "user",
});

const tools = {
  read: tool({
    execute: ({ path }: { path: string }) => `read ${path}`,
    inputSchema: z.object({ path: z.string() }),
  }),
};

/** Calls `read` for each path in turn, then answers. */
const multiStep = (paths: readonly string[], answer = "Done.") => {
  let calls = 0;
  return new MockLanguageModelV4({
    doStream: () => {
      const path = paths[calls];
      calls += 1;
      return Promise.resolve(
        path ? toolCallStream("read", { path }) : textStream(answer)
      );
    },
  });
};

const steerFor = (text: string): TakenSteer => {
  const message = {
    authorId: newId("user"),
    createdAt: "2026-10-27T10:00:00.000Z",
    id: newId("message"),
    parts: [{ text, type: "text" as const }],
  };
  return {
    data: {
      answerId: newId("message"),
      message,
      previousAnswerId: newId("message"),
    },
    message: user(message.id, text),
  };
};

const userTexts = (model: MockLanguageModelV4, call: number): string[] =>
  (model.doStreamCalls[call]?.prompt ?? []).flatMap((message) =>
    message.role === "user"
      ? message.content.flatMap((part) =>
          part.type === "text" ? [part.text] : []
        )
      : []
  );

describe("runAgent steering", () => {
  it("gives the model a steer at the next step boundary and marks where it came", async () => {
    const model = multiStep(["a.txt"]);
    const steer = steerFor("Use b.txt instead.");
    const takeSteer = vi
      .fn<() => Promise<TakenSteer | null>>()
      .mockResolvedValueOnce(steer)
      .mockResolvedValue(null);
    const run = await runAgent({
      messages: [user("u1", "read a.txt")],
      model,
      takeSteer,
      tools,
    });
    if (!run.ok) {
      throw new Error(run.error.message);
    }
    const chunks = await readAll(run.value.stream);
    const outcome = await run.value.outcome;

    expect(userTexts(model, 0)).toEqual(["read a.txt"]);
    expect(userTexts(model, 1)).toEqual(["read a.txt", "Use b.txt instead."]);

    const types = chunks.map((chunk) => chunk.type);
    const marker = types.indexOf(`data-${STEER_DATA}`);
    expect(marker).toBeGreaterThan(types.indexOf("tool-output-available"));
    expect(types[marker + 1]).toBe("start-step");

    expect(outcome.status).toBe("succeeded");
    const parts = outcome.message.parts.map((part) => part.type);
    const stored = parts.indexOf(`data-${STEER_DATA}`);
    expect(parts.filter((type) => type === `data-${STEER_DATA}`)).toHaveLength(
      1
    );
    expect(parts[stored + 1]).toBe("step-start");
    expect(parts.slice(stored)).toContain("text");
    expect(parts.slice(0, stored)).toContain("tool-read");
  });

  it("asks only between steps, never before the first", async () => {
    const takeSteer = vi.fn(() => Promise.resolve(null));
    const oneStep = await runAgent({
      messages: [user("u1", "hi")],
      model: new MockLanguageModelV4({ doStream: textStream("Hello.") }),
      takeSteer,
    });
    if (!oneStep.ok) {
      throw new Error(oneStep.error.message);
    }
    await readAll(oneStep.value.stream);
    await oneStep.value.outcome;
    expect(takeSteer).not.toHaveBeenCalled();

    const twoSteps = await runAgent({
      messages: [user("u1", "read a.txt")],
      model: multiStep(["a.txt"]),
      takeSteer,
      tools,
    });
    if (!twoSteps.ok) {
      throw new Error(twoSteps.error.message);
    }
    await readAll(twoSteps.value.stream);
    await twoSteps.value.outcome;
    expect(takeSteer).toHaveBeenCalledTimes(1);
  });

  it("keeps a steer in the model's view for every later step", async () => {
    const model = multiStep(["a.txt", "b.txt"]);
    const takeSteer = vi
      .fn<() => Promise<TakenSteer | null>>()
      .mockResolvedValueOnce(steerFor("Then read b.txt."))
      .mockResolvedValue(null);
    const run = await runAgent({
      messages: [user("u1", "read a.txt")],
      model,
      takeSteer,
      tools,
    });
    if (!run.ok) {
      throw new Error(run.error.message);
    }
    await readAll(run.value.stream);
    await run.value.outcome;
    expect(userTexts(model, 2)).toEqual(["read a.txt", "Then read b.txt."]);
  });
});

describe("withSteers", () => {
  const data = (): SteerData => steerFor("x").data;
  const answer = (steps: number): UIMessage => ({
    id: "a1",
    parts: Array.from({ length: steps }, (_, index) => [
      { type: "step-start" as const },
      { text: `step ${index}`, type: "text" as const },
    ]).flat(),
    role: "assistant",
  });

  it("puts each marker before the step it came before, counting from this pass", () => {
    const steer = data();
    // Two steps from an earlier pass, then this pass's steps 0 and 1.
    const marked = withSteers(answer(4), new Map([[1, steer]]), 2);
    const types = marked.parts.map((part) => part.type);
    expect(types).toEqual([
      "step-start",
      "text",
      "step-start",
      "text",
      "step-start",
      "text",
      `data-${STEER_DATA}`,
      "step-start",
      "text",
    ]);
  });

  it("leaves an answer without steers as it is", () => {
    const message = answer(2);
    expect(withSteers(message, new Map(), 0)).toBe(message);
  });
});
