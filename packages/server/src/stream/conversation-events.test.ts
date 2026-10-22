import type {
  ConversationId,
  UserId,
} from "@workspace/contract/schemas/common";
import type { ConversationEvent } from "@workspace/contract/schemas/conversations";
import type { UserSummary } from "@workspace/contract/schemas/tenancy";
import { createConversation } from "@workspace/db/queries/conversations";
import { insertMessage } from "@workspace/db/queries/messages";
import { createRun, transitionRun } from "@workspace/db/queries/runs";
import {
  createTestDb,
  expectOk,
  seedOrg,
  seedUser,
  type TestDb,
} from "@workspace/db/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  type ConversationEvents,
  conversationEventsResponse,
  createConversationEvents,
  presentUsers,
} from "./conversation-events";
import { type PgliteListener, pgliteListen } from "./listen";

let testDb: TestDb;
let events: ConversationEvents;
beforeAll(async () => {
  testDb = await createTestDb();
  events = createConversationEvents({
    db: testDb.db,
    listen:
      testDb.engine === "pglite"
        ? pgliteListen(
            (testDb.db as unknown as { $client: PgliteListener }).$client
          )
        : undefined,
  });
});
afterAll(async () => {
  await events.stop();
  await testDb.close();
});

const summary = (row: {
  readonly email: string;
  readonly id: string;
  readonly name: string;
}): UserSummary => ({
  email: row.email,
  id: row.id as UserId,
  image: null,
  name: row.name,
});

const newChat = async () => {
  const { db } = testDb;
  const owner = await seedUser(db, { name: "Ada" });
  const org = await seedOrg(db, owner.id, { isPersonal: true });
  const context = { id: org.id, type: "personal" } as const;
  const chat = await createConversation(db, { context, ownerId: owner.id });
  return {
    context,
    id: chat.id as ConversationId,
    owner: summary(owner),
  };
};

/** Reads events from `follow` into an array until aborted. */
const recorder = (
  conversationId: ConversationId,
  viewer: UserSummary
): {
  readonly seen: ConversationEvent[];
  readonly stop: () => Promise<void>;
  readonly until: (
    predicate: (seen: readonly ConversationEvent[]) => boolean
  ) => Promise<void>;
} => {
  const controller = new AbortController();
  const seen: ConversationEvent[] = [];
  const done = (async () => {
    for await (const event of events.follow(
      conversationId,
      viewer,
      controller.signal
    )) {
      seen.push(event);
    }
  })();
  return {
    seen,
    stop: async () => {
      controller.abort();
      await done;
    },
    until: async (predicate) => {
      const deadline = Date.now() + 5000;
      while (!predicate(seen)) {
        if (Date.now() > deadline) {
          throw new Error(`timed out; saw ${JSON.stringify(seen)}`);
        }
        // biome-ignore lint/performance/noAwaitInLoops: polls the recorder until the event lands.
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    },
  };
};

describe("presentUsers", () => {
  it("lists each person once, however many tabs they have open", () => {
    const ada = { email: null, id: "a" as UserId, image: null, name: "Ada" };
    const bo = { email: null, id: "b" as UserId, image: null, name: "Bo" };
    expect(
      presentUsers([{ viewer: ada }, { viewer: bo }, { viewer: ada }])
    ).toEqual([ada, bo]);
  });
});

describe.skipIf(process.env.TEST_DATABASE_URL)("conversation events", () => {
  it("tells followers who is present as people come and go", async () => {
    const chat = await newChat();
    const maya = summary(await seedUser(testDb.db, { name: "Maya" }));
    const ada = recorder(chat.id, chat.owner);
    await ada.until((seen) => seen.length === 1);
    const other = recorder(chat.id, maya);
    await ada.until((seen) => seen.length === 2);
    await other.stop();
    await ada.until((seen) => seen.length === 3);
    await ada.stop();
    expect(ada.seen).toEqual([
      { type: "presence", users: [chat.owner] },
      { type: "presence", users: [chat.owner, maya] },
      { type: "presence", users: [chat.owner] },
    ]);
  });

  it("forwards a person's message and each run status from the database", async () => {
    const { db } = testDb;
    const chat = await newChat();
    const watcher = recorder(chat.id, chat.owner);
    const question = expectOk(
      await insertMessage(db, {
        authorId: chat.owner.id,
        conversationId: chat.id,
        parentId: null,
        parts: [{ text: "hi", type: "text" }],
        role: "user",
      })
    );
    const { run } = await createRun(db, {
      context: chat.context,
      conversationId: chat.id,
      createdBy: chat.owner.id,
      status: "queued",
      target: { model: "fast", type: "model" },
      userMessageId: question.id,
    });
    expectOk(await transitionRun(db, run.id, { type: "start" }));
    expectOk(await transitionRun(db, run.id, { type: "succeed" }));
    await watcher.until((seen) => seen.length >= 5);
    await watcher.stop();
    expect(watcher.seen.slice(1)).toEqual([
      { authorId: chat.owner.id, messageId: question.id, type: "message" },
      { runId: run.id, status: "queued", type: "run" },
      { runId: run.id, status: "running", type: "run" },
      { runId: run.id, status: "succeeded", type: "run" },
    ]);
  });

  it("publishes typing only to the conversation it's for", async () => {
    const chat = await newChat();
    const elsewhere = await newChat();
    const here = recorder(chat.id, chat.owner);
    const there = recorder(elsewhere.id, elsewhere.owner);
    await events.publish(chat.id, { type: "typing", user: chat.owner });
    await here.until((seen) => seen.some((event) => event.type === "typing"));
    await here.stop();
    await there.stop();
    expect(there.seen.map((event) => event.type)).toEqual(["presence"]);
  });

  it("streams events as SSE and leaves the room when the client goes", async () => {
    const chat = await newChat();
    const request = new AbortController();
    const response = conversationEventsResponse(
      events,
      chat.id,
      chat.owner,
      new Request("http://test/", { signal: request.signal })
    );
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    const reader = response.body?.getReader();
    const first = await reader?.read();
    expect(new TextDecoder().decode(first?.value)).toBe(
      `data: ${JSON.stringify({ type: "presence", users: [chat.owner] })}\n\n`
    );
    const maya = summary(await seedUser(testDb.db, { name: "Maya" }));
    const watcher = recorder(chat.id, maya);
    await watcher.until((seen) => seen.length === 1);
    request.abort();
    await reader?.cancel();
    await watcher.until((seen) => seen.length === 2);
    await watcher.stop();
    expect(watcher.seen).toEqual([
      { type: "presence", users: [chat.owner, maya] },
      { type: "presence", users: [maya] },
    ]);
  });
});
