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
import { createRun, getRun, transitionRun } from "./runs";
import { removeUnrunTurn, takeSteer } from "./steers";

let testDb: TestDb;
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
  const say = async (text: string, parentId: string | null) =>
    expectOk(
      await insertMessage(db, {
        authorId: owner.id,
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
    delivery: "queue" | "steer"
  ) => {
    const asked = await say(text, parentId);
    const queued = (
      await createRun(db, {
        afterRunId: after as never,
        context,
        conversationId: chat.id,
        createdBy: owner.id,
        options: { delivery, sandbox: "auto", webSearch: "auto" },
        target: { model: "fast", type: "model" },
        userMessageId: asked.id,
      })
    ).run;
    return { asked, queued };
  };
  return { answer, chat, db, queue, running };
};

describe("takeSteer", () => {
  test("puts the steer after the answer so far and gives the run a new answer under it", async () => {
    const { answer, chat, db, queue, running } = await answering();
    const steer = await queue("use b", answer.id, running.id, "steer");

    const taken = await takeSteer(db, running.id);

    expect(taken).toMatchObject({
      previousAnswerId: answer.id,
      run: { id: steer.queued.id, status: "cancelled" },
      userMessage: { id: steer.asked.id },
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
    expect(await takeSteer(db, running.id)).toBeNull();
  });

  test("leaves a plain queued turn queued", async () => {
    const { answer, db, queue, running } = await answering();
    const next = await queue("later", answer.id, running.id, "queue");
    expect(await takeSteer(db, running.id)).toBeNull();
    expect(expectOk(await getRun(db, next.queued.id)).status).toBe("queued");
  });

  test("leaves a steer that a turn already queued behind as the next turn", async () => {
    const { answer, db, queue, running } = await answering();
    const steer = await queue("use b", answer.id, running.id, "steer");
    await queue("and then c", steer.asked.id, steer.queued.id, "queue");
    expect(await takeSteer(db, running.id)).toBeNull();
    expect(expectOk(await getRun(db, steer.queued.id)).status).toBe("queued");
  });

  test("takes nothing for a run that isn't running", async () => {
    const { answer, db, queue, running } = await answering();
    await queue("use b", answer.id, running.id, "steer");
    expectOk(await transitionRun(db, running.id, { type: "succeed" }));
    expect(await takeSteer(db, running.id)).toBeNull();
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
