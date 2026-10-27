import { STEER_DATA } from "@workspace/ai/messages/steer";
import { textStream, toolCallStream } from "@workspace/ai/testing/mock-models";
import type {
  ConversationId,
  MessageId,
  RunId,
  UserId,
} from "@workspace/contract/schemas/common";
import type { Conversation } from "@workspace/contract/schemas/conversations";
import type {
  CreateRunOutput,
  Run,
  TurnDelivery,
} from "@workspace/contract/schemas/runs";
import { upsertGrant } from "@workspace/db/queries/grants";
import { getBranchPath, newestLeafId } from "@workspace/db/queries/messages";
import { getRun, readRunChunks } from "@workspace/db/queries/runs";
import { expectOk, seedOrg, seedUser } from "@workspace/db/testing";
import { tool } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  createHarness,
  type Harness,
  scriptedModel,
  textParts,
} from "../testing/harness";

// Steering (`delivery: "steer"`), through the API and the executor: a turn
// sent while an answer is being written joins that answer at its next step
// boundary, and the tree shows it where it was taken. One the answer can't
// take runs as the next turn.

let h: Harness | undefined;
afterEach(() => h?.close());

/** A tool whose call waits until the test lets it finish. */
const gatedTool = () => {
  let release: () => void = () => undefined;
  let called: () => void = () => undefined;
  const done = new Promise<void>((resolve) => {
    release = resolve;
  });
  const calledOnce = new Promise<void>((resolve) => {
    called = resolve;
  });
  return {
    called: calledOnce,
    release: () => release(),
    tools: {
      wait: tool({
        execute: async () => {
          called();
          await done;
          return "waited";
        },
        inputSchema: z.object({}),
      }),
    },
  };
};

/** Calls `wait`, then answers. */
const callThenAnswer = (answer: string) => {
  let calls = 0;
  return new MockLanguageModelV4({
    doStream: () => {
      calls += 1;
      return Promise.resolve(
        calls === 1 ? toolCallStream("wait", {}) : textStream(answer)
      );
    },
  });
};

const newChat = async (harness: Harness): Promise<ConversationId> =>
  (
    (await (
      await harness.request("/api/conversations", { json: {}, method: "POST" })
    ).json()) as Conversation
  ).id;

const send = async (
  harness: Harness,
  conversationId: ConversationId,
  text: string,
  parentId: MessageId | null,
  delivery?: TurnDelivery
): Promise<CreateRunOutput> => {
  const response = await harness.request("/api/runs", {
    json: {
      conversationId,
      input: { parentId, parts: [{ text, type: "text" }], type: "message" },
      ...(delivery ? { options: { delivery } } : {}),
      target: { model: "test:chat", type: "model" },
    },
    method: "POST",
  });
  if (response.status !== 202) {
    throw new Error(`POST /api/runs answered ${response.status}`);
  }
  return (await response.json()) as CreateRunOutput;
};

const runOf = async (harness: Harness, id: RunId) =>
  expectOk(await getRun(harness.db, id));

const pathOf = async (harness: Harness, conversationId: ConversationId) => {
  const leaf = await newestLeafId(harness.db, conversationId);
  return expectOk(
    await getBranchPath(harness.db, conversationId, leaf as MessageId)
  ).messages;
};

const textOf = (parts: readonly { type: string; text?: string }[]) =>
  parts.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("");

const userTexts = (model: MockLanguageModelV4, call: number): string[] =>
  (model.doStreamCalls[call]?.prompt ?? []).flatMap((message) =>
    message.role === "user"
      ? message.content.flatMap((part) =>
          part.type === "text" ? [part.text] : []
        )
      : []
  );

/** A turn whose first step waits in `wait` until released. */
const busyTurn = async (harness: Harness, answer = "Done.") => {
  const gate = gatedTool();
  const model = callThenAnswer(answer);
  harness.nextTurn({ model, tools: gate.tools });
  const chat = await newChat(harness);
  const first = await send(harness, chat, "Look into it.", null);
  await gate.called;
  const answering = await runOf(harness, first.runId);
  return { answering, chat, first, gate, model };
};

describe("steering a running answer", () => {
  it("joins at the next step: the model reads it, and the tree shows it where it was taken", async () => {
    h = await createHarness();
    const { answering, chat, first, gate, model } = await busyTurn(
      h,
      "Using the steer."
    );
    const firstAnswer = answering.assistantMessageId as MessageId;

    const steer = await send(h, chat, "Focus on b.", firstAnswer, "steer");
    expect(steer.status).toBe("queued");
    gate.release();
    await h.services.executor.idle();

    expect(userTexts(model, 1)).toEqual(["Look into it.", "Focus on b."]);
    const path = await pathOf(h, chat);
    expect(path.map((message) => message.role)).toEqual([
      "user",
      "assistant",
      "user",
      "assistant",
    ]);
    const [, before, steered, after] = path;
    expect(before).toMatchObject({ id: firstAnswer, status: "complete" });
    expect(before?.parts.some((part) => part.type === "tool-call")).toBe(true);
    expect(steered).toMatchObject({ id: steer.userMessageId });
    expect(after).toMatchObject({ runId: first.runId, status: "complete" });
    expect(textOf(after?.parts ?? [])).toBe("Using the steer.");
    expect(
      path
        .flatMap((message) => message.parts)
        .some((part) => part.type === "data" && part.name === STEER_DATA)
    ).toBe(false);

    expect(await runOf(h, first.runId)).toMatchObject({
      assistantMessageId: after?.id,
      status: "succeeded",
    });
    expect(await runOf(h, steer.runId)).toMatchObject({
      assistantMessageId: null,
      status: "cancelled",
    });
    const chunks = await readRunChunks(h.db, first.runId);
    expect(
      chunks.some(
        (chunk) =>
          (chunk.payload as { type?: string }).type === `data-${STEER_DATA}`
      )
    ).toBe(true);
  });

  it("restarts an answer that has only written so far, with every message, and answers once", async () => {
    h = await createHarness();
    const first = scriptedModel();
    h.nextTurn({ model: first.model });
    const chat = await newChat(h);
    const asked = await send(h, chat, "Say hi.", null);
    first.push(...textParts.start(), textParts.delta("Hal"));
    const restarted = scriptedModel();
    h.nextTurn({ model: restarted.model });
    const answering = (await runOf(h, asked.runId)).assistantMessageId;
    const two = await send(h, chat, "And bye.", answering, "steer");
    // Sent while the restarted answer is still writing: it restarts again.
    restarted.push(...textParts.start(), textParts.delta("Hi"));
    const last = new MockLanguageModelV4({
      doStream: textStream("Hi, and bye, and thanks."),
    });
    h.nextTurn({ model: last });
    const three = await send(h, chat, "And thanks.", answering, "steer");
    await h.services.executor.idle();

    expect(await runOf(h, asked.runId)).toMatchObject({ status: "cancelled" });
    expect(userTexts(last, 0)).toEqual(["Say hi.", "And bye.", "And thanks."]);
    expect(await runOf(h, three.runId)).toMatchObject({ status: "succeeded" });
    expect(two.runId).not.toBe(three.runId);
    // The stopped answers stay as branches the thread doesn't show.
    const path = await pathOf(h, chat);
    expect(path.map((message) => textOf(message.parts))).toEqual([
      "Say hi.",
      "And bye.",
      "And thanks.",
      "Hi, and bye, and thanks.",
    ]);
  });

  it("batches quick messages into one take at the next step boundary", async () => {
    h = await createHarness();
    const { answering, chat, gate, model } = await busyTurn(
      h,
      "Using b and c."
    );
    const firstAnswer = answering.assistantMessageId as MessageId;
    const steer = await send(h, chat, "Focus on b.", firstAnswer, "steer");
    const joined = await send(h, chat, "And c.", firstAnswer, "steer");
    // The second joins the first's batch: one run answers both.
    expect(joined.runId).toBe(steer.runId);
    gate.release();
    await h.services.executor.idle();

    expect(model.doStreamCalls).toHaveLength(2);
    expect(userTexts(model, 1)).toEqual([
      "Look into it.",
      "Focus on b.",
      "And c.",
    ]);
    const path = await pathOf(h, chat);
    expect(path.map((message) => textOf(message.parts))).toEqual([
      "Look into it.",
      "",
      "Focus on b.",
      "And c.",
      "Using b and c.",
    ]);
  });

  it("answers messages sent after the last step boundary together, as the next turn", async () => {
    h = await createHarness();
    const gate = gatedTool();
    const writing = scriptedModel();
    let calls = 0;
    const model = new MockLanguageModelV4({
      doStream: (options) => {
        calls += 1;
        return calls === 1
          ? Promise.resolve(toolCallStream("wait", {}))
          : writing.model.doStream(options);
      },
    });
    h.nextTurn({ model, tools: gate.tools });
    const chat = await newChat(h);
    const first = await send(h, chat, "Look into it.", null);
    await gate.called;
    gate.release();
    writing.push(...textParts.start(), textParts.delta("Found it"));
    // The last step is under way: nothing more can take these.
    await vi.waitFor(() => expect(calls).toBe(2));
    const answer = (await runOf(h, first.runId)).assistantMessageId;
    const next = await send(h, chat, "Now b.", answer, "steer");
    const joined = await send(h, chat, "And c.", answer, "steer");
    expect(joined.runId).toBe(next.runId);
    const after = new MockLanguageModelV4({ doStream: textStream("B and c.") });
    h.nextTurn({ model: after });
    writing.push(textParts.textEnd(), textParts.finish());
    writing.end();
    await h.services.executor.idle();

    expect(userTexts(after, 0)).toEqual(["Look into it.", "Now b.", "And c."]);
    const path = await pathOf(h, chat);
    expect(path.map((message) => textOf(message.parts)).slice(-3)).toEqual([
      "Now b.",
      "And c.",
      "B and c.",
    ]);
  });

  it("queues a plain turn, as before", async () => {
    h = await createHarness();
    const { answering, chat, gate } = await busyTurn(h);
    const queued = await send(
      h,
      chat,
      "Later.",
      answering.assistantMessageId,
      "queue"
    );
    h.nextTurn({
      model: new MockLanguageModelV4({ doStream: textStream("Later, then.") }),
    });
    gate.release();
    await h.services.executor.idle();
    const path = await pathOf(h, chat);
    expect(path.map((message) => textOf(message.parts)).slice(-2)).toEqual([
      "Later.",
      "Later, then.",
    ]);
    expect(await runOf(h, queued.runId)).toMatchObject({ status: "succeeded" });
  });

  it("queues a turn sent from the answer before a steer behind the run that took it", async () => {
    h = await createHarness();
    const one = gatedTool();
    const two = gatedTool();
    let calls = 0;
    const model = new MockLanguageModelV4({
      doStream: () => {
        calls += 1;
        if (calls === 1) {
          return Promise.resolve(toolCallStream("wait", {}, "call-1"));
        }
        return Promise.resolve(
          calls === 2
            ? toolCallStream("hold", {}, "call-2")
            : textStream("Both done.")
        );
      },
    });
    h.nextTurn({ model, tools: { ...one.tools, hold: two.tools.wait } });
    const chat = await newChat(h);
    const first = await send(h, chat, "Look into it.", null);
    await one.called;
    const firstAnswer = (await runOf(h, first.runId))
      .assistantMessageId as MessageId;
    await send(h, chat, "Focus on b.", firstAnswer, "steer");
    one.release();
    // The second step's call means the steer was taken before it.
    await two.called;
    // A page that hadn't seen the steer still sends from the first answer.
    const late = await send(h, chat, "One more.", firstAnswer, "queue");
    expect(late.status).toBe("queued");
    h.nextTurn({
      model: new MockLanguageModelV4({ doStream: textStream("Sure.") }),
    });
    two.release();
    await h.services.executor.idle();
    const path = await pathOf(h, chat);
    expect(path.map((message) => textOf(message.parts))).toEqual([
      "Look into it.",
      "",
      "Focus on b.",
      "Both done.",
      "One more.",
      "Sure.",
    ]);
  });
});

describe("the queue's actions", () => {
  it("steer now marks a queued turn, and the answer takes it", async () => {
    h = await createHarness();
    const { answering, chat, gate, model } = await busyTurn(h);
    const queued = await send(
      h,
      chat,
      "Focus on b.",
      answering.assistantMessageId
    );
    const promoted = await h.request(`/api/runs/${queued.runId}/steer`, {
      method: "POST",
    });
    expect(promoted.status).toBe(200);
    expect(((await promoted.json()) as Run).options?.delivery).toBe("steer");
    gate.release();
    await h.services.executor.idle();
    expect(userTexts(model, 1)).toEqual(["Look into it.", "Focus on b."]);
  });

  it("withdraw takes a queued turn back, message and all", async () => {
    h = await createHarness();
    const { answering, chat, gate } = await busyTurn(h);
    const queued = await send(
      h,
      chat,
      "Never mind.",
      answering.assistantMessageId
    );
    const withdrawn = await h.request(`/api/runs/${queued.runId}/withdraw`, {
      method: "POST",
    });
    expect(withdrawn.status).toBe(200);
    expect(await withdrawn.json()).toMatchObject({
      messageRemoved: true,
      run: { state: { status: "cancelled" } },
    });
    gate.release();
    await h.services.executor.idle();
    const path = await pathOf(h, chat);
    expect(path.map((message) => textOf(message.parts))).not.toContain(
      "Never mind."
    );
    const again = await h.request(`/api/runs/${queued.runId}/withdraw`, {
      method: "POST",
    });
    expect(again.status).toBe(404);
  });

  it("refuses a turn that already started", async () => {
    h = await createHarness();
    const { first, gate } = await busyTurn(h);
    for (const action of ["steer", "withdraw"]) {
      // biome-ignore lint/performance/noAwaitInLoops: two requests, in turn.
      const response = await h.request(`/api/runs/${first.runId}/${action}`, {
        method: "POST",
      });
      expect(response.status).toBe(409);
    }
    gate.release();
    await h.services.executor.idle();
  });

  /** Someone the chat is shared with at `permission`. */
  const collaborator = async (
    harness: Harness,
    chat: ConversationId,
    permission: "editor" | "viewer"
  ): Promise<UserId> => {
    const person = await seedUser(harness.db);
    await seedOrg(harness.db, person.id, { isPersonal: true });
    expectOk(
      await upsertGrant(harness.db, {
        grantedBy: harness.ownerId,
        permission,
        principal: { id: person.id, type: "user" },
        resource: { resourceId: chat, resourceType: "conversation" },
      })
    );
    return person.id as UserId;
  };

  const tryActions = (harness: Harness, runId: RunId, as: UserId) =>
    Promise.all(
      ["steer", "withdraw"].map(async (action) => {
        const response = await harness.request(`/api/runs/${runId}/${action}`, {
          as,
          method: "POST",
        });
        return response.status;
      })
    );

  it("someone who can only read the chat can't steer or take back a turn", async () => {
    h = await createHarness();
    const { answering, chat, gate } = await busyTurn(h);
    const queued = await send(
      h,
      chat,
      "Later.",
      answering.assistantMessageId,
      "queue"
    );
    const reader = await collaborator(h, chat, "viewer");
    expect(await tryActions(h, queued.runId, reader)).toEqual([403, 403]);
    h.nextTurn({
      model: new MockLanguageModelV4({ doStream: textStream("Later, then.") }),
    });
    gate.release();
    await h.services.executor.idle();
    expect(await runOf(h, queued.runId)).toMatchObject({ status: "succeeded" });
  });

  it("an editor who didn't send a turn can't steer or take it back, and their own steer runs as their turn", async () => {
    h = await createHarness();
    const { answering, chat, gate, model } = await busyTurn(h);
    const queued = await send(
      h,
      chat,
      "Later.",
      answering.assistantMessageId,
      "queue"
    );
    const editor = await collaborator(h, chat, "editor");
    expect(await tryActions(h, queued.runId, editor)).toEqual([403, 403]);

    const response = await h.request("/api/runs", {
      as: editor,
      json: {
        conversationId: chat,
        input: {
          parentId: answering.assistantMessageId,
          parts: [{ text: "Focus on b.", type: "text" }],
          type: "message",
        },
        options: { delivery: "steer" },
        target: { model: "test:chat", type: "model" },
      },
      method: "POST",
    });
    expect(response.status).toBe(202);
    const theirs = (await response.json()) as CreateRunOutput;
    h.nextTurn({
      model: new MockLanguageModelV4({ doStream: textStream("Later, then.") }),
    });
    h.nextTurn({
      model: new MockLanguageModelV4({
        doStream: textStream("For the editor."),
      }),
    });
    gate.release();
    await h.services.executor.idle();
    // The owner's answer never read it: it ran as the editor's own turn.
    expect(userTexts(model, 1)).toEqual(["Look into it."]);
    expect(await runOf(h, theirs.runId)).toMatchObject({
      createdBy: editor,
      status: "succeeded",
    });
  });
});
