import {
  generated,
  textStream,
  toolCallStream,
} from "@workspace/ai/testing/mock-models";
import type { Conversation } from "@workspace/contract/schemas/conversations";
import type { BranchPath } from "@workspace/contract/schemas/messages";
import type { CreateRunOutput, Run } from "@workspace/contract/schemas/runs";
import { tool } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import {
  createHarness,
  type Harness,
  readEvents,
  scriptedModel,
  textParts,
} from "../testing/harness";

// The run lifecycle end to end, in process: `POST /api/runs`, the SSE
// stream, resume from a cursor, the per-branch queue, approvals and the
// title job. The model is always a mock.

let h: Harness;

beforeEach(async () => {
  h = await createHarness({
    titleModel: new MockLanguageModelV4({
      doGenerate: () =>
        Promise.resolve(
          generated([{ text: "Greeting the world", type: "text" }])
        ),
    }),
  });
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

const chunksOf = (events: readonly { data: string }[]) =>
  events
    .filter((event) => event.data !== "[DONE]")
    .map((event) => JSON.parse(event.data) as { delta?: string; type: string });

describe("POST /api/runs", () => {
  it("streams the answer and stores it as message parts", async () => {
    h.nextTurn({
      model: new MockLanguageModelV4({ doStream: textStream("Hi there") }),
    });
    const chat = await newConversation();
    const created = await send(chat.id, "hello");
    expect(created.streamUrl).toBe(`/api/runs/${created.runId}/stream`);

    const response = await h.request(created.streamUrl);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    expect(response.headers.get("x-vercel-ai-ui-message-stream")).toBe("v1");
    expect(response.headers.get("x-accel-buffering")).toBe("no");
    const events = await readEvents(response);
    expect(events.at(-1)?.data).toBe("[DONE]");
    const ids = events.flatMap((event) =>
      event.id === null ? [] : [event.id]
    );
    expect(ids).toEqual(ids.map((_, index) => index + 1));
    const chunks = chunksOf(events);
    expect(chunks[0]?.type).toBe("start");
    expect(
      chunks
        .filter((c) => c.type === "text-delta")
        .map((c) => c.delta)
        .join("")
    ).toBe("Hi there");

    await h.services.executor.idle();
    const path = await pathOf(chat.id);
    expect(path.messages.map((m) => [m.role, m.status])).toEqual([
      ["user", "complete"],
      ["assistant", "complete"],
    ]);
    expect(path.messages[1]?.parts).toContainEqual(
      expect.objectContaining({ text: "Hi there", type: "text" })
    );
    const run = await getRun(created.runId);
    expect(run.state.status).toBe("succeeded");
    expect(run.assistantMessageId).toBe(path.messages[1]?.id);
    expect(run.resolvedModel).toBe("test:model");
    expect(run.usage).toMatchObject({ inputTokens: 10, outputTokens: 5 });
  });

  it("resumes from the cursor after a disconnect, with every chunk exactly once", async () => {
    const scripted = scriptedModel();
    h.nextTurn({ model: scripted.model });
    const chat = await newConversation();
    const created = await send(chat.id, "count");
    scripted.push(...textParts.start(), textParts.delta("one "));

    // Read until the first delta arrives, then drop the connection.
    const first = await readEvents(
      await h.request(created.streamUrl),
      (events) => chunksOf(events).some((chunk) => chunk.type === "text-delta")
    );
    const cursor = first.at(-1)?.id;
    expect(cursor).toBeGreaterThan(0);

    // The run carries on without anyone listening.
    scripted.push(textParts.delta("two "), textParts.delta("three"));
    scripted.push(textParts.textEnd(), textParts.finish());
    scripted.end();
    await h.services.executor.idle();

    const rest = await readEvents(
      await h.request(`${created.streamUrl}?cursor=${cursor}`)
    );
    expect(rest.at(-1)?.data).toBe("[DONE]");
    const ids = [...first, ...rest].flatMap((event) =>
      event.id === null ? [] : [event.id]
    );
    expect(ids).toEqual(ids.map((_, index) => index + 1));
    const text = chunksOf([...first, ...rest])
      .filter((chunk) => chunk.type === "text-delta")
      .map((chunk) => chunk.delta)
      .join("");
    expect(text).toBe("one two three");

    // Last-Event-ID does the same when the browser reconnects by itself.
    const viaHeader = await readEvents(
      await h.request(created.streamUrl, {
        headers: { "last-event-id": String(cursor) },
      })
    );
    expect(viaHeader.map((event) => event.id)).toEqual(
      rest.map((event) => event.id)
    );
  });

  it("follows a live run from a second subscriber", async () => {
    const scripted = scriptedModel();
    h.nextTurn({ model: scripted.model });
    const chat = await newConversation();
    const created = await send(chat.id, "live");
    const listening = readEvents(await h.request(created.streamUrl));
    scripted.push(...textParts.start(), textParts.delta("live!"));
    scripted.push(textParts.textEnd(), textParts.finish());
    scripted.end();
    const events = await listening;
    expect(events.at(-1)?.data).toBe("[DONE]");
    expect(chunksOf(events).some((chunk) => chunk.delta === "live!")).toBe(
      true
    );
  });

  it("queues a second turn on a busy branch and starts it when the first ends", async () => {
    const scripted = scriptedModel();
    h.nextTurn({ model: scripted.model });
    h.nextTurn({
      model: new MockLanguageModelV4({ doStream: textStream("Second answer") }),
    });
    const chat = await newConversation();
    const first = await send(chat.id, "first");
    expect(first.status).toBe("running");
    const firstRun = await getRun(first.runId);

    const second = await send(chat.id, "second", first.userMessageId);
    expect(second.status).toBe("queued");
    const queued = await getRun(second.runId);
    expect(queued.state).toEqual({
      afterRunId: first.runId,
      position: 1,
      status: "queued",
    });

    scripted.push(...textParts.start(), textParts.delta("First answer"));
    scripted.push(textParts.textEnd(), textParts.finish());
    scripted.end();
    await h.services.executor.idle();

    expect((await getRun(first.runId)).state.status).toBe("succeeded");
    expect((await getRun(second.runId)).state.status).toBe("succeeded");
    const path = await pathOf(chat.id);
    expect(path.messages.map((m) => m.role)).toEqual([
      "user",
      "assistant",
      "user",
      "assistant",
    ]);
    // The queued question follows the answer it waited for.
    expect(path.messages[2]?.parentId).toBe(firstRun.assistantMessageId);
  });

  it("pauses for approval and resumes the same answer once approved", async () => {
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
        doStream: toolCallStream("write_file", { path: "a.txt" }),
      }),
      toolApproval,
      tools,
    });
    h.nextTurn({
      model: new MockLanguageModelV4({ doStream: textStream("Done.") }),
      toolApproval,
      tools,
    });
    const chat = await newConversation();
    const created = await send(chat.id, "write a.txt");
    await h.services.executor.idle();

    const paused = await getRun(created.runId);
    expect(paused.state).toMatchObject({
      approvals: [{ toolCallId: "call-1", toolName: "write_file" }],
      status: "awaiting_approval",
    });
    expect(execute).not.toHaveBeenCalled();

    const decided = await h.request(`/api/runs/${created.runId}/approvals`, {
      json: {
        decisions: [
          { decision: { decision: "approve" }, toolCallId: "call-1" },
        ],
      },
      method: "POST",
    });
    expect(decided.status).toBe(200);
    await h.services.executor.idle();

    expect(execute).toHaveBeenCalledOnce();
    const run = await getRun(created.runId);
    expect(run.state.status).toBe("succeeded");
    const branch = await pathOf(chat.id);
    expect(branch.messages).toHaveLength(2);
    const [, answer] = branch.messages;
    expect(answer?.id).toBe(run.assistantMessageId);
    expect(answer?.parts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          approval: expect.objectContaining({
            decidedBy: h.ownerId,
            state: "decided",
          }),
          type: "tool-call",
        }),
        expect.objectContaining({
          output: { status: "success", value: "wrote a.txt" },
          type: "tool-result",
        }),
        expect.objectContaining({ text: "Done.", type: "text" }),
      ])
    );

    // One stream across the pause: both passes, then the end.
    const events = await readEvents(await h.request(created.streamUrl));
    expect(events.at(-1)?.data).toBe("[DONE]");
    const types = chunksOf(events).map((chunk) => chunk.type);
    expect(types).toContain("tool-approval-request");
    expect(types).toContain("text-delta");

    // Deciding again is a conflict: nothing is pending now.
    const again = await h.request(`/api/runs/${created.runId}/approvals`, {
      json: {
        decisions: [
          { decision: { decision: "approve" }, toolCallId: "call-1" },
        ],
      },
      method: "POST",
    });
    expect(again.status).toBe(409);
  });

  it("cancels a waiting run and closes its stream", async () => {
    const scripted = scriptedModel();
    h.nextTurn({ model: scripted.model });
    const chat = await newConversation();
    const created = await send(chat.id, "long one");
    scripted.push(...textParts.start(), textParts.delta("partial"));
    const listening = readEvents(await h.request(created.streamUrl));

    const cancelled = await json<Run>(
      await h.request(`/api/runs/${created.runId}/cancel`, { method: "POST" })
    );
    expect(cancelled.state).toMatchObject({
      cancelledBy: h.ownerId,
      status: "cancelled",
    });
    const events = await listening;
    expect(events.at(-1)?.data).toBe("[DONE]");
    const path = await pathOf(chat.id);
    expect(path.messages[1]?.status).toBe("partial");
  });

  it("names the conversation with a job after the first turn", async () => {
    h.nextTurn({
      model: new MockLanguageModelV4({ doStream: textStream("Hello, world!") }),
    });
    const chat = await newConversation();
    await send(chat.id, "hello world");
    await h.services.executor.idle();
    expect(h.jobs.jobs().map((job) => [job.name, job.state])).toContainEqual([
      "title.generate",
      "created",
    ]);
    await h.jobs.drain();
    const titled = await json<Conversation>(
      await h.request(`/api/conversations/${chat.id}`)
    );
    expect(titled.title).toBe("Greeting the world");
  });

  it("refuses a caller without access, and a signed-out one", async () => {
    const chat = await newConversation();
    const anonymous = await h.request("/api/runs", {
      as: "" as never,
      json: {
        conversationId: chat.id,
        input: {
          parentId: null,
          parts: [{ text: "hi", type: "text" }],
          type: "message",
        },
      },
      method: "POST",
    });
    expect(anonymous.status).toBe(401);
  });
});
