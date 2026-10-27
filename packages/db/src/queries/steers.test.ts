import type { RunId } from "@workspace/contract/schemas/common";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

import {
  createTestDb,
  expectOk,
  seedOrg,
  seedUser,
  type TestDb,
} from "../testing";
import { createConversation } from "./conversations";
import {
  getBranchPath,
  getMessage,
  insertMessage,
  newestLeafId,
} from "./messages";
import { appendRunChunks, createRun, getRun, transitionRun } from "./runs";
import {
  followThread,
  nextSteer,
  removeUnrunTurn,
  steerInstead,
  takeSteer,
  toolWorkStarted,
} from "./steers";

let testDb: TestDb;

/** What the executor does between steps: find the steer, then take it. */
const take = async (db: TestDb["db"], runId: RunId) => {
  const candidate = await nextSteer(db, runId);
  return candidate ? await takeSteer(db, runId, candidate) : null;
};
beforeAll(async () => {
  testDb = await createTestDb();
});
afterAll(() => testDb.close());

/** A chat whose first question is being answered, as a claimed run leaves it. */
const answering = async () => {
  const { db } = testDb;
  const owner = await seedUser(db);
  const org = await seedOrg(db, owner.id, { isPersonal: true });
  const context = { id: org.id, type: "personal" } as const;
  const chat = await createConversation(db, { context, ownerId: owner.id });
  const say = async (
    text: string,
    parentId: string | null,
    by: string = owner.id
  ) =>
    expectOk(
      await insertMessage(db, {
        authorId: by as never,
        conversationId: chat.id,
        parentId: parentId as never,
        parts: [{ text, type: "text" }],
        role: "user",
      })
    );
  const question = await say("hi", null);
  const running = (
    await createRun(db, {
      context,
      conversationId: chat.id,
      createdBy: owner.id,
      target: { model: "fast", type: "model" },
      userMessageId: question.id,
    })
  ).run;
  const answer = expectOk(
    await insertMessage(db, {
      authorId: null,
      conversationId: chat.id,
      parentId: question.id,
      parts: [],
      role: "assistant",
      runId: running.id,
      status: "partial",
    })
  );
  expectOk(
    await transitionRun(db, running.id, {
      assistantMessageId: answer.id,
      type: "start",
    })
  );
  /** A turn queued behind `after`, under `parentId`, as `placeRun` places it. */
  const queue = async (
    text: string,
    parentId: string,
    after: string,
    delivery: "queue" | "steer",
    by: string = owner.id
  ) => {
    const asked = await say(text, parentId, by);
    const queued = (
      await createRun(db, {
        afterRunId: after as never,
        context,
        conversationId: chat.id,
        createdBy: by as never,
        options: { delivery, sandbox: "auto", webSearch: "auto" },
        target: { model: "fast", type: "model" },
        userMessageId: asked.id,
      })
    ).run;
    return { asked, queued };
  };
  return { answer, chat, context, db, question, queue, running, say };
};

describe("takeSteer", () => {
  test("puts the steer after the answer so far and gives the run a new answer under it", async () => {
    const { answer, chat, db, queue, running } = await answering();
    const steer = await queue("use b", answer.id, running.id, "steer");

    const taken = await take(db, running.id);

    expect(taken).toMatchObject({
      previousAnswerId: answer.id,
      run: { id: steer.queued.id, status: "cancelled" },
      userMessages: [{ id: steer.asked.id }],
    });
    expect(taken?.answer).toMatchObject({
      parentId: steer.asked.id,
      role: "assistant",
      runId: running.id,
      status: "partial",
    });
    expect(expectOk(await getRun(db, running.id))).toMatchObject({
      assistantMessageId: taken?.answer.id,
      status: "running",
    });
    const leaf = await newestLeafId(db, chat.id);
    expect(leaf).toBe(taken?.answer.id);
    const path = expectOk(await getBranchPath(db, chat.id, leaf as never));
    expect(path.messages.map((message) => message.id)).toEqual([
      expect.any(String),
      answer.id,
      steer.asked.id,
      taken?.answer.id,
    ]);
    expect(await take(db, running.id)).toBeNull();
  });

  test("leaves someone else's steer queued: the run goes on as its own creator", async () => {
    const { answer, db, queue, running } = await answering();
    const other = await seedUser(db);
    const steer = await queue(
      "use b",
      answer.id,
      running.id,
      "steer",
      other.id
    );
    expect(await take(db, running.id)).toBeNull();
    expect(expectOk(await getRun(db, steer.queued.id)).status).toBe("queued");
  });

  test("takes only the steer it was asked for, after the same answer", async () => {
    const { answer, db, queue, running } = await answering();
    const steer = await queue("use b", answer.id, running.id, "steer");
    const candidate = await nextSteer(db, running.id);
    expect(candidate).toMatchObject({
      answerId: answer.id,
      runId: steer.queued.id,
    });
    const asked = candidate as NonNullable<typeof candidate>;
    // Read before, changed since: a different answer, or the steer stopped.
    expect(
      await takeSteer(db, running.id, { ...asked, answerId: steer.asked.id })
    ).toBeNull();
    expectOk(
      await transitionRun(db, steer.queued.id, {
        cancelledBy: null,
        type: "cancel",
      })
    );
    expect(await takeSteer(db, running.id, asked)).toBeNull();
    expect(expectOk(await getRun(db, running.id)).assistantMessageId).toBe(
      answer.id
    );
  });

  test("leaves a plain queued turn queued", async () => {
    const { answer, db, queue, running } = await answering();
    const next = await queue("later", answer.id, running.id, "queue");
    expect(await take(db, running.id)).toBeNull();
    expect(expectOk(await getRun(db, next.queued.id)).status).toBe("queued");
  });

  test("takes the steer with every message sent under it, as one batch", async () => {
    const { answer, chat, db, queue, running, say } = await answering();
    const steer = await queue("use b", answer.id, running.id, "steer");
    // A quick second message joins the steer's batch: no run of its own.
    const also = await say("and c", steer.asked.id);

    const taken = await take(db, running.id);

    expect(taken?.userMessages.map((each) => each.id)).toEqual([
      steer.asked.id,
      also.id,
    ]);
    expect(taken?.answer.parentId).toBe(also.id);
    expect(await newestLeafId(db, chat.id)).toBe(taken?.answer.id);
  });

  test("moves someone else's turn queued behind the steer after the answer that goes on", async () => {
    const { answer, chat, db, queue, running } = await answering();
    const steer = await queue("use b", answer.id, running.id, "steer");
    const other = await seedUser(db);
    const later = await queue(
      "and then c",
      steer.asked.id,
      steer.queued.id,
      "queue",
      other.id
    );

    const taken = await take(db, running.id);

    expect(taken?.answer.parentId).toBe(steer.asked.id);
    expect(expectOk(await getMessage(db, later.asked.id)).parentId).toBe(
      taken?.answer.id
    );
    expect(expectOk(await getRun(db, later.queued.id))).toMatchObject({
      afterRunId: running.id,
      status: "queued",
    });
    // Every child is newer than its parent, so the branch's newest message
    // is still its end.
    expect(await newestLeafId(db, chat.id)).toBe(later.asked.id);
  });

  test("takes nothing for a run that isn't running", async () => {
    const { answer, db, queue, running } = await answering();
    await queue("use b", answer.id, running.id, "steer");
    expectOk(await transitionRun(db, running.id, { type: "succeed" }));
    expect(await take(db, running.id)).toBeNull();
  });
});

describe("removeUnrunTurn", () => {
  test("removes a cancelled turn's message and run when nothing follows it", async () => {
    const { answer, db, queue, running } = await answering();
    const next = await queue("later", answer.id, running.id, "queue");
    expectOk(
      await transitionRun(db, next.queued.id, {
        cancelledBy: null,
        type: "cancel",
      })
    );
    expect(await removeUnrunTurn(db, next.queued.id)).toBe(true);
    expect((await getMessage(db, next.asked.id)).ok).toBe(false);
    expect((await getRun(db, next.queued.id)).ok).toBe(false);
  });

  test("keeps a turn that is still queued, or that another turn follows", async () => {
    const { answer, db, queue, running } = await answering();
    const first = await queue("later", answer.id, running.id, "queue");
    expect(await removeUnrunTurn(db, first.queued.id)).toBe(false);
    await queue("after that", first.asked.id, first.queued.id, "queue");
    expectOk(
      await transitionRun(db, first.queued.id, {
        cancelledBy: null,
        type: "cancel",
      })
    );
    expect(await removeUnrunTurn(db, first.queued.id)).toBe(false);
    expect((await getMessage(db, first.asked.id)).ok).toBe(true);
  });
});

describe("followThread", () => {
  test("takes a quick message to its batch's question, then to the batch's answer", async () => {
    const { answer, db, queue, running, say } = await answering();
    const steer = await queue("use b", answer.id, running.id, "steer");
    const also = await say("and c", steer.asked.id);
    // Waiting: the batch's run is under its first message.
    expect(await followThread(db, also.id)).toBe(steer.asked.id);
    const taken = await take(db, running.id);
    // Taken: the answer under the batch is where the thread is.
    expect(await followThread(db, also.id)).toBe(taken?.answer.id);
  });

  test("takes a stopped answer to the turn that replaced it", async () => {
    const { answer, db, queue, running } = await answering();
    const next = await queue("instead", answer.id, running.id, "queue");
    expectOk(
      await transitionRun(db, running.id, { cancelledBy: null, type: "abort" })
    );
    expect(await followThread(db, answer.id)).toBe(next.asked.id);
  });

  test("leaves an answer that stands where it is", async () => {
    const { answer, db } = await answering();
    expect(await followThread(db, answer.id)).toBe(answer.id);
  });
});

describe("toolWorkStarted", () => {
  test("is false until the run's stream has a tool call", async () => {
    const { db, running } = await answering();
    expect(await toolWorkStarted(db, running.id)).toBe(false);
    expectOk(await appendRunChunks(db, running.id, [{ type: "text-delta" }]));
    expect(await toolWorkStarted(db, running.id)).toBe(false);
    expectOk(
      await appendRunChunks(db, running.id, [
        { toolCallId: "c1", toolName: "read", type: "tool-input-start" },
      ])
    );
    expect(await toolWorkStarted(db, running.id)).toBe(true);
  });
});

describe("steerInstead", () => {
  test("turns a restart's turn into a steer after the answer so far", async () => {
    const { answer, context, db, question, running, say } = await answering();
    // Placed to restart: beside the answer, under the question.
    const asked = await say("and c", question.id);
    const turn = (
      await createRun(db, {
        afterRunId: running.id,
        context,
        conversationId: answer.conversationId,
        createdBy: asked.authorId as never,
        target: { model: "fast", type: "model" },
        userMessageId: asked.id,
      })
    ).run;
    await steerInstead(db, turn, running.id);
    expect(expectOk(await getMessage(db, asked.id)).parentId).toBe(answer.id);
    expect(expectOk(await getRun(db, turn.id)).options).toMatchObject({
      delivery: "steer",
    });
    // The answer takes it at its next step.
    expect((await take(db, running.id))?.answer.parentId).toBe(asked.id);
  });
});
