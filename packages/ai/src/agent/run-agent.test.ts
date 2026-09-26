import { newId } from "@workspace/shared/ids";
import { tool, type UIMessage } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { fromUIMessage } from "../messages/from-ui";
import { toUIMessages } from "../messages/to-ui";
import {
  readAll,
  textStream,
  toolCallStream,
  usage,
} from "../testing/mock-models";
import { callSettings } from "./call-settings";
import { runAgent } from "./run-agent";

const user = (text: string): UIMessage => ({
  id: "u1",
  parts: [{ text, type: "text" }],
  role: "user",
});

const fileUrl = (id: string) => `/files/${id}`;

describe("callSettings", () => {
  it("maps reasoning effort and keeps the rest", () => {
    expect(callSettings({ reasoningEffort: "off", temperature: 0.2 })).toEqual({
      reasoning: "none",
      temperature: 0.2,
    });
    expect(callSettings({}).reasoning).toBeUndefined();
  });
});

describe("runAgent", () => {
  it("streams an answer and reports usage", async () => {
    const model = new MockLanguageModelV4({
      doStream: textStream("Hi there", usage(7, 3)),
    });
    const run = await runAgent({
      generateMessageId: () => "a1",
      instructions: "Be brief.",
      messages: [user("hello")],
      model,
      parameters: { temperature: 0 },
    });
    if (!run.ok) {
      throw new Error(run.error.message);
    }
    const chunks = await readAll(run.value.stream);
    expect(chunks.map((c) => c.type)).toContain("text-delta");
    const outcome = await run.value.outcome;
    expect(outcome).toMatchObject({
      message: {
        id: "a1",
        parts: expect.arrayContaining([
          { state: "done", text: "Hi there", type: "text" },
        ]),
      },
      status: "succeeded",
      usage: { inputTokens: 7, outputTokens: 3 },
    });
    expect(model.doStreamCalls[0]).toMatchObject({ temperature: 0 });
    expect(model.doStreamCalls[0]?.prompt[0]).toEqual({
      content: "Be brief.",
      role: "system",
    });
  });

  it("pauses at a tool that needs approval, then runs it once approved", async () => {
    const execute = vi.fn(({ path }: { path: string }) => `wrote ${path}`);
    const tools = {
      write_file: tool({
        execute,
        inputSchema: z.object({ path: z.string() }),
      }),
    };
    const first = await runAgent({
      messages: [user("write a.txt")],
      model: new MockLanguageModelV4({
        doStream: toolCallStream("write_file", { path: "a.txt" }),
      }),
      toolApproval: { write_file: "user-approval" },
      tools,
    });
    if (!first.ok) {
      throw new Error(first.error.message);
    }
    await readAll(first.value.stream);
    const paused = await first.value.outcome;
    expect(paused).toMatchObject({
      approvals: [
        {
          input: { path: "a.txt" },
          toolCallId: "call-1",
          toolName: "write_file",
        },
      ],
      status: "awaiting_approval",
    });
    expect(execute).not.toHaveBeenCalled();

    // What 014 does: store the answer, record the decision, rebuild, resume.
    const decidedBy = newId("user");
    const stored = fromUIMessage(paused.message, {
      decisionFor: () => undefined,
      now: () => new Date("2026-09-27T10:00:00Z"),
    });
    if (!stored.ok) {
      throw new Error(stored.error.type);
    }
    const withDecision = stored.value.map((part) =>
      part.type === "tool-call"
        ? {
            ...part,
            approval: {
              decidedAt: "2026-09-27T10:01:00.000Z",
              decidedBy,
              decision: { decision: "approve" as const },
              state: "decided" as const,
            },
          }
        : part
    );
    const history = toUIMessages(
      [
        {
          id: "u1",
          parts: [{ text: "write a.txt", type: "text" }],
          role: "user",
        },
        { id: paused.message.id, parts: withDecision, role: "assistant" },
      ],
      { fileUrl }
    );
    const second = await runAgent({
      messages: history,
      model: new MockLanguageModelV4({ doStream: textStream("Done.") }),
      toolApproval: { write_file: "user-approval" },
      tools,
    });
    if (!second.ok) {
      throw new Error(second.error.message);
    }
    await readAll(second.value.stream);
    const finished = await second.value.outcome;
    expect(execute).toHaveBeenCalledOnce();
    expect(finished.status).toBe("succeeded");
    expect(finished.message.parts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          output: "wrote a.txt",
          state: "output-available",
        }),
        expect.objectContaining({ text: "Done.", type: "text" }),
      ])
    );
  });

  it("fails with a safe error when the provider does", async () => {
    const model = new MockLanguageModelV4({
      doStream: () => Promise.reject(new Error("upstream said sk-live-secret")),
    });
    const run = await runAgent({ messages: [user("hi")], model });
    if (!run.ok) {
      throw new Error(run.error.message);
    }
    const chunks = await readAll(run.value.stream);
    const outcome = await run.value.outcome;
    expect(outcome).toMatchObject({
      error: { code: "internal" },
      status: "failed",
    });
    expect(JSON.stringify(chunks)).not.toContain("sk-live");
  });

  it("reports a cancelled run", async () => {
    const controller = new AbortController();
    controller.abort();
    const run = await runAgent({
      messages: [user("hi")],
      model: new MockLanguageModelV4({ doStream: textStream("never") }),
      signal: controller.signal,
    });
    if (!run.ok) {
      throw new Error(run.error.message);
    }
    await readAll(run.value.stream);
    expect((await run.value.outcome).status).toBe("cancelled");
  });
});
