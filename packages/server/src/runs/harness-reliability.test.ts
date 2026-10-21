import { interruptionOf } from "@workspace/ai/messages/approval";
import {
  streamOf,
  textStream,
  toolCallStream,
  usage,
} from "@workspace/ai/testing/mock-models";
import type { RunId } from "@workspace/contract/schemas/common";
import type { Conversation } from "@workspace/contract/schemas/conversations";
import type { MessagePart } from "@workspace/contract/schemas/message-parts";
import type { BranchPath } from "@workspace/contract/schemas/messages";
import type { CreateRunOutput, Run } from "@workspace/contract/schemas/runs";
import { approvalIdsOf } from "@workspace/db/queries/runs";
import { tool } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { createHarness, type Harness, readEvents } from "../testing/harness";
import { interruptLeftovers, partialOutputOf, sameDecision } from "./interrupt";

// Approvals and Stop as the harness audit measured them (072): decisions
// are announced on the stream, recorded once, and atomic; Stop reaches the
// server, resolves what was waiting and kills what was running.

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => h.close());

const json = async <T>(response: Response, status = 200): Promise<T> => {
  if (response.status !== status) {
    throw new Error(
      `expected ${status}, got ${response.status}: ${await response.text()}`
    );
  }
  return (await response.json()) as T;
};

const newConversation = async () =>
  json<Conversation>(
    await h.request("/api/conversations", { json: {}, method: "POST" }),
    201
  );

const send = async (
  conversationId: string,
  text: string,
  parentId: string | null = null
) =>
  json<CreateRunOutput>(
    await h.request("/api/runs", {
      json: {
        conversationId,
        input: { parentId, parts: [{ text, type: "text" }], type: "message" },
        target: { model: "test:model", type: "model" },
      },
      method: "POST",
    }),
    202
  );

const getRun = async (id: string) =>
  json<Run>(await h.request(`/api/runs/${id}`));

const pathOf = async (conversationId: string) =>
  json<BranchPath>(
    await h.request(`/api/conversations/${conversationId}/path`)
  );

const decide = (
  runId: string,
  decisions: readonly { decision: unknown; toolCallId: string }[]
) =>
  h.request(`/api/runs/${runId}/approvals`, {
    json: { decisions },
    method: "POST",
  });

const chunksOf = (events: readonly { data: string }[]) =>
  events
    .filter((event) => event.data !== "[DONE]")
    .map(
      (event) =>
        JSON.parse(event.data) as {
          approvalId?: string;
          approved?: boolean;
          errorText?: string;
          toolCallId?: string;
          type: string;
        }
    );

const approve = { decision: "approve" } as const;

/** Two writes the model asks for in one step, and a reply once they ran. */
const twoWrites = () => {
  const execute = vi.fn(({ path }: { path: string }) => `wrote ${path}`);
  const tools = {
    write_file: tool({ execute, inputSchema: z.object({ path: z.string() }) }),
  };
  const toolApproval = { write_file: "user-approval" } as const;
  h.nextTurn({
    model: new MockLanguageModelV4({
      doStream: () =>
        Promise.resolve(
          streamOf([
            { type: "stream-start", warnings: [] },
            {
              input: JSON.stringify({ path: "a.txt" }),
              toolCallId: "call-a",
              toolName: "write_file",
              type: "tool-call",
            },
            {
              input: JSON.stringify({ path: "b.txt" }),
              toolCallId: "call-b",
              toolName: "write_file",
              type: "tool-call",
            },
            {
              finishReason: { raw: "tool_calls", unified: "tool-calls" },
              type: "finish",
              usage: usage(),
            },
          ])
        ),
    }),
    toolApproval,
    tools,
  });
  h.nextTurn({
    model: new MockLanguageModelV4({ doStream: textStream("Both done.") }),
    toolApproval,
    tools,
  });
  return execute;
};

const toolParts = (path: BranchPath) =>
  (path.messages.at(-1)?.parts ?? []).filter(
    (
      part
    ): part is Extract<MessagePart, { type: "tool-call" | "tool-result" }> =>
      part.type === "tool-call" || part.type === "tool-result"
  );

describe("deciding", () => {
  it("announces each decision on the stream, once, before the pass resumes", async () => {
    const execute = twoWrites();
    const chat = await newConversation();
    const created = await send(chat.id, "write two files");
    await h.services.executor.idle();

    expect(
      (
        await decide(created.runId, [
          { decision: approve, toolCallId: "call-a" },
        ])
      ).status
    ).toBe(200);
    // The same decision again (a retry, a second tab) is a no-op…
    expect(
      (
        await decide(created.runId, [
          { decision: approve, toolCallId: "call-a" },
        ])
      ).status
    ).toBe(200);
    // …and a different one is refused: the first decision stands.
    const flip = await decide(created.runId, [
      { decision: { decision: "reject", reason: "no" }, toolCallId: "call-a" },
    ]);
    expect(flip.status).toBe(409);
    expect(await getRun(created.runId)).toMatchObject({
      state: { status: "awaiting_approval" },
    });

    expect(
      (
        await decide(created.runId, [
          { decision: approve, toolCallId: "call-b" },
        ])
      ).status
    ).toBe(200);
    await h.services.executor.idle();
    expect(execute).toHaveBeenCalledTimes(2);
    expect((await getRun(created.runId)).state.status).toBe("succeeded");

    const chunks = chunksOf(
      await readEvents(await h.request(created.streamUrl))
    );
    // Each response names its call by the id the SDK asked under.
    const asked = new Map(
      chunks.flatMap((c) =>
        c.type === "tool-approval-request" && c.approvalId
          ? [[c.approvalId, c.toolCallId]]
          : []
      )
    );
    const responses = chunks.filter((c) => c.type === "tool-approval-response");
    expect(
      responses.map((c) => [asked.get(c.approvalId ?? ""), c.approved])
    ).toEqual([
      ["call-a", true],
      ["call-b", true],
    ]);
    // The response for call-b comes before the output its pass produced.
    const types = chunks.map(
      (c) => `${c.type}:${c.toolCallId ?? asked.get(c.approvalId ?? "") ?? ""}`
    );
    expect(types.indexOf("tool-approval-response:call-b")).toBeLessThan(
      types.indexOf("tool-output-available:call-b")
    );

    // After the run moved on, the same decision is still a no-op, a flip a conflict.
    expect(
      (
        await decide(created.runId, [
          { decision: approve, toolCallId: "call-b" },
        ])
      ).status
    ).toBe(200);
    expect(
      (
        await decide(created.runId, [
          { decision: { decision: "reject" }, toolCallId: "call-b" },
        ])
      ).status
    ).toBe(409);
  });

  it("keeps both of two decisions made at once, and resumes the run once", async () => {
    const execute = twoWrites();
    const chat = await newConversation();
    const created = await send(chat.id, "write two files");
    await h.services.executor.idle();

    const answers = await Promise.all([
      decide(created.runId, [{ decision: approve, toolCallId: "call-a" }]),
      decide(created.runId, [{ decision: approve, toolCallId: "call-b" }]),
    ]);
    expect(answers.map((answer) => answer.status)).toEqual([200, 200]);
    await h.services.executor.idle();
    expect(execute).toHaveBeenCalledTimes(2);
    const calls = toolParts(await pathOf(chat.id)).filter(
      (part) => part.type === "tool-call"
    );
    expect(
      calls.map((call) => call.type === "tool-call" && call.approval.state)
    ).toEqual(["decided", "decided"]);
  });
});

describe("stopping", () => {
  it("resolves a waiting run's calls as not run, on the stream and in the answer", async () => {
    twoWrites();
    const chat = await newConversation();
    const created = await send(chat.id, "write two files");
    await h.services.executor.idle();
    await decide(created.runId, [{ decision: approve, toolCallId: "call-a" }]);

    const listening = readEvents(await h.request(created.streamUrl));
    const cancelled = await json<Run>(
      await h.request(`/api/runs/${created.runId}/cancel`, { method: "POST" })
    );
    expect(cancelled.state).toMatchObject({ status: "cancelled" });

    const chunks = chunksOf(await listening);
    const stopped = chunks.filter((c) => c.type === "tool-output-error");
    expect(stopped.map((c) => c.toolCallId).sort()).toEqual([
      "call-a",
      "call-b",
    ]);
    expect(
      stopped.every((c) => interruptionOf(c.errorText ?? "")?.by === "user")
    ).toBe(true);

    const parts = toolParts(await pathOf(chat.id));
    const results = parts.flatMap((part) =>
      part.type === "tool-result" && part.output.status === "error"
        ? [[part.toolCallId, interruptionOf(part.output.message)?.started]]
        : []
    );
    // Neither ran: one was approved but its pass never started.
    expect(results).toEqual([
      ["call-a", true],
      ["call-b", false],
    ]);
  });

  it("aborts a running command and keeps what it had printed", async () => {
    let signalled = false;
    const tools = {
      bash: tool({
        execute: (_input: { command: string }, { abortSignal }) =>
          new Promise<{ exitCode: number; stderr: string; stdout: string }>(
            (resolve) => {
              abortSignal?.addEventListener("abort", () => {
                signalled = true;
                resolve({
                  exitCode: 124,
                  stderr: "killed",
                  stdout: "step 1\nstep 2",
                });
              });
            }
          ),
        inputSchema: z.object({ command: z.string() }),
      }),
    };
    h.nextTurn({
      model: new MockLanguageModelV4({
        doStream: toolCallStream("bash", { command: "sleep 20" }, "call-sh"),
      }),
      tools,
    });
    const chat = await newConversation();
    const created = await send(chat.id, "run something slow");
    const listening = readEvents(await h.request(created.streamUrl));
    await vi.waitFor(async () => {
      const path = await pathOf(chat.id);
      expect(path.messages).toHaveLength(2);
    });
    // Give the tool call a moment to start.
    await new Promise((resolve) => setTimeout(resolve, 50));
    const cancelled = await json<Run>(
      await h.request(`/api/runs/${created.runId}/cancel`, { method: "POST" })
    );
    expect(cancelled.state).toMatchObject({ status: "cancelled" });
    expect(signalled).toBe(true);

    const chunks = chunksOf(await listening);
    expect(chunks.find((c) => c.type === "tool-output-error")?.toolCallId).toBe(
      "call-sh"
    );
    const result = toolParts(await pathOf(chat.id)).find(
      (part) => part.type === "tool-result"
    );
    const message =
      result?.type === "tool-result" && result.output.status === "error"
        ? result.output.message
        : "";
    expect(interruptionOf(message)).toEqual({
      by: "user",
      partial: "step 1\nstep 2\nkilled",
      started: true,
    });
  });

  it("moves on from a waiting answer when a new message is sent", async () => {
    const execute = twoWrites();
    const chat = await newConversation();
    const first = await send(chat.id, "write two files");
    await h.services.executor.idle();
    const waiting = await getRun(first.runId);

    h.nextTurn({
      model: new MockLanguageModelV4({ doStream: textStream("Sure.") }),
    });
    const second = await send(
      chat.id,
      "actually, don't",
      waiting.assistantMessageId
    );
    expect(second.status).toBe("running");
    await h.services.executor.idle();

    expect((await getRun(first.runId)).state.status).toBe("cancelled");
    expect((await getRun(second.runId)).state.status).toBe("succeeded");
    expect(execute).not.toHaveBeenCalled();
  });

  it("moves on from a waiting answer when the message replies under a question stopped behind it", async () => {
    const execute = vi.fn(({ path }: { path: string }) => `wrote ${path}`);
    const asking = gate();
    h.nextTurn({
      model: new MockLanguageModelV4({
        doStream: async () => {
          await asking.opened;
          return toolCallStream("write_file", { path: "a.txt" });
        },
      }),
      toolApproval: { write_file: "user-approval" },
      tools: {
        write_file: tool({
          execute,
          inputSchema: z.object({ path: z.string() }),
        }),
      },
    });
    const chat = await newConversation();
    const first = await send(chat.id, "write a file");
    const stopped = await send(chat.id, "and another", first.userMessageId);
    expect(stopped.status).toBe("queued");
    await json<Run>(
      await h.request(`/api/runs/${stopped.runId}/cancel`, { method: "POST" })
    );
    asking.open();
    await h.services.executor.idle();
    expect((await getRun(first.runId)).state.status).toBe("awaiting_approval");

    h.nextTurn({
      model: new MockLanguageModelV4({ doStream: textStream("Sure.") }),
    });
    const reply = await send(chat.id, "never mind", stopped.userMessageId);
    await h.services.executor.idle();

    expect((await getRun(first.runId)).state.status).toBe("cancelled");
    expect((await getRun(reply.runId)).state.status).toBe("succeeded");
    expect(execute).not.toHaveBeenCalled();
  });
});

/** A promise and the function that settles it, for holding a pass open. */
const gate = () => {
  const opening: { open?: () => void } = {};
  const opened = new Promise<void>((resolve) => {
    opening.open = resolve;
  });
  return { open: () => opening.open?.(), opened };
};

/**
 * One write the model asks for, its pass held open after the card went
 * out: in the model's stream (`hold: "stream"`, the step hasn't finished)
 * or while the pass settles (`hold: "settle"`, the outcome is in and the
 * patch is being proposed). Either way the run is still `running`.
 */
const heldWrite = (hold: "settle" | "stream") => {
  const execute = vi.fn(({ path }: { path: string }) => `wrote ${path}`);
  const held = gate();
  const call = {
    input: JSON.stringify({ path: "a.txt" }),
    toolCallId: "call-a",
    toolName: "write_file",
    type: "tool-call",
  } as const;
  const done = {
    finishReason: { raw: "tool_calls", unified: "tool-calls" },
    type: "finish",
    usage: usage(),
  } as const;
  h.nextTurn({
    model: new MockLanguageModelV4({
      doStream: () =>
        hold === "settle"
          ? Promise.resolve(
              streamOf([{ type: "stream-start", warnings: [] }, call, done])
            )
          : Promise.resolve({
              stream: new ReadableStream({
                pull: async (controller) => {
                  await held.opened;
                  controller.enqueue(done);
                  controller.close();
                },
                start: (controller) => {
                  controller.enqueue({ type: "stream-start", warnings: [] });
                  controller.enqueue(call);
                },
              }),
            }),
    }),
    proposeEdits:
      hold === "settle" ? () => held.opened.then(() => undefined) : undefined,
    toolApproval: { write_file: "user-approval" },
    tools: {
      write_file: tool({
        execute,
        inputSchema: z.object({ path: z.string() }),
      }),
    },
  });
  return { execute, release: held.open };
};

describe("a new message in the gap before a run pauses (133)", () => {
  for (const hold of ["stream", "settle"] as const) {
    it(`moves on when the card is out but the pass hasn't paused (held in ${hold})`, async () => {
      const { execute, release } = heldWrite(hold);
      const chat = await newConversation();
      const first = await send(chat.id, "write a file");
      // The card is on the stream, so a client can show it; the run hasn't
      // paused yet.
      await vi.waitFor(
        async () => {
          expect(
            (await approvalIdsOf(h.db, first.runId as RunId)).size
          ).toBeGreaterThan(0);
        },
        { interval: 5, timeout: 5000 }
      );
      const asked = await getRun(first.runId);
      expect(asked.state.status).toBe("running");

      h.nextTurn({
        model: new MockLanguageModelV4({ doStream: textStream("Sure.") }),
      });
      const sending = send(
        chat.id,
        "never mind, leave it",
        asked.assistantMessageId
      );
      // However the pass ends, it ends after the new message arrived.
      setTimeout(release, 20);
      const second = await sending;
      await h.services.executor.idle();

      expect((await getRun(first.runId)).state).toMatchObject({
        status: "cancelled",
      });
      expect((await getRun(second.runId)).state.status).toBe("succeeded");
      expect(execute).not.toHaveBeenCalled();
      // The change it asked for is answered as stopped by the sender.
      const answer = (await pathOf(chat.id)).messages.find(
        (message) => message.id === asked.assistantMessageId
      );
      const results = (answer?.parts ?? []).flatMap((part) =>
        part.type === "tool-result" && part.output.status === "error"
          ? [interruptionOf(part.output.message)?.by]
          : []
      );
      expect(results).toEqual(["user"]);
    });
  }

  it("still queues a message sent while a decided change runs", async () => {
    const execute = vi.fn(({ path }: { path: string }) => `wrote ${path}`);
    const tools = {
      write_file: tool({
        execute,
        inputSchema: z.object({ path: z.string() }),
      }),
    };
    const toolApproval = { write_file: "user-approval" } as const;
    h.nextTurn({
      model: new MockLanguageModelV4({
        doStream: () =>
          Promise.resolve(toolCallStream("write_file", { path: "a.txt" })),
      }),
      toolApproval,
      tools,
    });
    const held = gate();
    h.nextTurn({
      model: new MockLanguageModelV4({
        doStream: async () => {
          await held.opened;
          return textStream("Done.");
        },
      }),
      toolApproval,
      tools,
    });
    const chat = await newConversation();
    const first = await send(chat.id, "write a file");
    await h.services.executor.idle();
    await decide(first.runId, [{ decision: approve, toolCallId: "call-1" }]);
    const resumed = await getRun(first.runId);
    expect(resumed.state.status).toBe("running");

    h.nextTurn({
      model: new MockLanguageModelV4({ doStream: textStream("Next.") }),
    });
    // The card was answered: this is an ordinary turn behind a busy branch.
    const second = await send(chat.id, "and then?", resumed.assistantMessageId);
    expect(second.status).toBe("queued");
    held.open();
    await h.services.executor.idle();
    expect((await getRun(first.runId)).state.status).toBe("succeeded");
    expect((await getRun(second.runId)).state.status).toBe("succeeded");
    expect(execute).toHaveBeenCalledTimes(1);
  });
});

describe("interrupt (pure)", () => {
  it("gives each unanswered call a stopped result, and chunks only for streamed ones", () => {
    const parts: MessagePart[] = [
      {
        approval: { requestedAt: "2026-09-30T00:00:00.000Z", state: "pending" },
        input: {},
        toolCallId: "p",
        toolName: "write",
        type: "tool-call",
      },
      {
        approval: { state: "not-required" },
        input: {},
        toolCallId: "r",
        toolName: "bash",
        type: "tool-call",
      },
      {
        approval: { state: "not-required" },
        input: {},
        toolCallId: "done",
        toolName: "read",
        type: "tool-call",
      },
      {
        output: { status: "success", value: "x" },
        toolCallId: "done",
        toolName: "read",
        type: "tool-result",
      },
    ];
    const stopped = interruptLeftovers(parts, {
      by: "user",
      partial: new Map([["r", "half"]]),
      streamed: new Set(["p"]),
    });
    expect(stopped.toolCallIds).toEqual(["p", "r"]);
    expect(
      stopped.chunks.map((c) => c.type === "tool-output-error" && c.toolCallId)
    ).toEqual(["p"]);
    expect(
      stopped.parts.map(
        (p) => `${p.type}:${"toolCallId" in p ? p.toolCallId : ""}`
      )
    ).toEqual([
      "tool-call:p",
      "tool-result:p",
      "tool-call:r",
      "tool-result:r",
      "tool-call:done",
      "tool-result:done",
    ]);
  });

  it("compares decisions by content and reads partial output", () => {
    expect(
      sameDecision(
        {
          comments: [],
          decision: "review",
          hunks: [{ decision: "accept", hunkId: "h1" }],
        },
        {
          comments: [],
          decision: "review",
          hunks: [{ decision: "accept", hunkId: "h1" }],
        } as never
      )
    ).toBe(true);
    expect(sameDecision({ decision: "approve" }, { decision: "reject" })).toBe(
      false
    );
    expect(partialOutputOf({ stderr: "", stdout: "hi\n" })).toBe("hi");
    expect(partialOutputOf("text")).toBeUndefined();
  });
});
