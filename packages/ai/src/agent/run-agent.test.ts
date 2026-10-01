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

  describe("a call the run can't make is a tool error the model reads", () => {
    const tools = {
      read: tool({
        execute: ({ path }: { path: string }) => `read ${path}`,
        inputSchema: z.object({ path: z.string() }),
      }),
    };
    /** First a call, then whatever the model says after reading its result. */
    const callThenAnswer = (toolName: string, input: unknown) => {
      let calls = 0;
      return new MockLanguageModelV4({
        doStream: () => {
          calls += 1;
          return Promise.resolve(
            calls === 1
              ? toolCallStream(toolName, input)
              : textStream("Recovered.")
          );
        },
      });
    };
    /** What the model was told about the call, in the step after it. */
    const toolErrorSeen = (model: MockLanguageModelV4): unknown =>
      model.doStreamCalls[1]?.prompt
        .flatMap((message) =>
          message.role === "tool" ? [...message.content] : []
        )
        .find((part) => part.type === "tool-result")?.output;

    it("tells the model a tool it doesn't have isn't there, and goes on", async () => {
      const model = callThenAnswer("frobnicate", { path: "a.txt" });
      const run = await runAgent({
        messages: [user("frobnicate a.txt")],
        model,
        tools,
      });
      if (!run.ok) {
        throw new Error(run.error.message);
      }
      const chunks = await readAll(run.value.stream);
      const outcome = await run.value.outcome;

      expect(outcome.status).toBe("succeeded");
      expect(model.doStreamCalls).toHaveLength(2);
      expect(toolErrorSeen(model)).toEqual({
        type: "error-text",
        value: expect.stringContaining("unavailable tool 'frobnicate'"),
      });
      expect(chunks.map((chunk) => chunk.type)).not.toContain("error");
      expect(outcome.message.parts).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            errorText: expect.stringContaining(
              "unavailable tool 'frobnicate'. Available tools: read."
            ),
            state: "output-error",
            toolCallId: "call-1",
          }),
          expect.objectContaining({ text: "Recovered.", type: "text" }),
        ])
      );
    });

    it("gives the reason a withheld tool isn't available", async () => {
      const model = callThenAnswer("write", { path: "a.txt" });
      const run = await runAgent({
        messages: [user("write a.txt")],
        model,
        tools,
        unavailableTools: { write: "`write` isn't available while planning." },
      });
      if (!run.ok) {
        throw new Error(run.error.message);
      }
      await readAll(run.value.stream);
      const outcome = await run.value.outcome;
      expect(outcome.status).toBe("succeeded");
      expect(toolErrorSeen(model)).toEqual({
        type: "error-text",
        value: expect.stringContaining(
          "`write` isn't available while planning."
        ),
      });
      expect(outcome.message.parts).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            errorText: "`write` isn't available while planning.",
            state: "output-error",
          }),
        ])
      );
    });

    it("treats a tool left out of activeTools the same way", async () => {
      const model = callThenAnswer("read", { path: "a.txt" });
      const run = await runAgent({
        activeTools: [],
        messages: [user("read a.txt")],
        model,
        tools,
      });
      if (!run.ok) {
        throw new Error(run.error.message);
      }
      await readAll(run.value.stream);
      expect((await run.value.outcome).status).toBe("succeeded");
      expect(toolErrorSeen(model)).toEqual({
        type: "error-text",
        value: expect.stringContaining("unavailable tool 'read'"),
      });
    });

    it("tells the model its arguments don't fit, so it can correct them", async () => {
      const model = callThenAnswer("read", { path: 42 });
      const run = await runAgent({
        messages: [user("read 42")],
        model,
        tools,
      });
      if (!run.ok) {
        throw new Error(run.error.message);
      }
      await readAll(run.value.stream);
      const outcome = await run.value.outcome;
      expect(outcome.status).toBe("succeeded");
      expect(toolErrorSeen(model)).toEqual({
        type: "error-text",
        value: expect.stringContaining("Invalid input for tool read"),
      });
      expect(outcome.message.parts).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            errorText: expect.stringContaining("Invalid input for tool read"),
            state: "output-error",
          }),
        ])
      );
    });

    it("stores the failed call with its input and error, and the next turn builds from it", async () => {
      const first = await runAgent({
        messages: [user("read 42")],
        model: callThenAnswer("read", { path: 42 }),
        tools,
      });
      if (!first.ok) {
        throw new Error(first.error.message);
      }
      await readAll(first.value.stream);
      const answer = await first.value.outcome;
      const stored = fromUIMessage(answer.message, {
        decisionFor: () => undefined,
        now: () => new Date("2026-10-02T10:00:00Z"),
      });
      if (!stored.ok) {
        throw new Error(stored.error.type);
      }
      expect(stored.value).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            input: { path: 42 },
            toolName: "read",
            type: "tool-call",
          }),
          expect.objectContaining({
            output: {
              message: expect.stringContaining("Invalid input for tool read"),
              status: "error",
            },
            type: "tool-result",
          }),
        ])
      );

      const history = toUIMessages(
        [
          {
            id: "u1",
            parts: [{ text: "read 42", type: "text" }],
            role: "user",
          },
          { id: "a1", parts: stored.value, role: "assistant" },
          {
            id: "u2",
            parts: [{ text: "and again", type: "text" }],
            role: "user",
          },
        ],
        { fileUrl }
      );
      const model = new MockLanguageModelV4({ doStream: textStream("Sure.") });
      const second = await runAgent({ messages: history, model, tools });
      if (!second.ok) {
        throw new Error(second.error.message);
      }
      await readAll(second.value.stream);
      expect((await second.value.outcome).status).toBe("succeeded");
    });

    it("stops a model that keeps calling a missing tool at the step limit", async () => {
      const model = new MockLanguageModelV4({
        doStream: () => Promise.resolve(toolCallStream("frobnicate", {})),
      });
      const run = await runAgent({
        maxSteps: 3,
        messages: [user("loop")],
        model,
        tools,
      });
      if (!run.ok) {
        throw new Error(run.error.message);
      }
      await readAll(run.value.stream);
      expect((await run.value.outcome).status).toBe("succeeded");
      expect(model.doStreamCalls).toHaveLength(3);
    });
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
