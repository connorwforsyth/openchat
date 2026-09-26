import { afterAll, beforeAll, describe, expect, test } from "vitest";
import {
  createTestDb,
  expectOk,
  seedOrg,
  seedTeam,
  seedUser,
  type TestDb,
} from "../testing";
import {
  createConversation,
  listParticipants,
  setParticipantState,
} from "./conversations";
import { upsertGrant } from "./grants";
import {
  deleteMessage,
  getMessageTree,
  insertMessage,
  listMessages,
} from "./messages";
import {
  createRun,
  getRun,
  listRuns,
  requeueAfter,
  setRunResolvedModel,
  transitionRun,
} from "./runs";
import { personalOrgOf, teamLineage } from "./teams";

// Queries added for the run service and chat routes (ticket 014).

let testDb: TestDb;
beforeAll(async () => {
  testDb = await createTestDb();
});
afterAll(() => testDb.close());

const setup = async () => {
  const { db } = testDb;
  const owner = await seedUser(db);
  const org = await seedOrg(db, owner.id, { isPersonal: true });
  const context = { id: org.id, type: "personal" } as const;
  const chat = await createConversation(db, { context, ownerId: owner.id });
  const say = (
    text: string,
    parentId: Parameters<typeof insertMessage>[1]["parentId"]
  ) =>
    insertMessage(db, {
      authorId: owner.id,
      conversationId: chat.id,
      parentId,
      parts: [{ text, type: "text" }],
      role: "user",
    }).then(expectOk);
  const newRun = (
    userMessageId: Awaited<ReturnType<typeof say>>["id"],
    afterRunId: string | null = null
  ) =>
    createRun(db, {
      afterRunId: afterRunId as never,
      context,
      conversationId: chat.id,
      createdBy: owner.id,
      target: { model: "fast", type: "model" },
      userMessageId,
    }).then((created) => created.run);
  return { chat, db, newRun, org, owner, say };
};

describe("runs", () => {
  test("requeueAfter moves waiting runs to the run ahead", async () => {
    const { db, newRun, say } = await setup();
    const question = await say("q", null);
    const a = await newRun(question.id);
    const b = await newRun(question.id, a.id);
    const c = await newRun(question.id, b.id);
    const moved = await requeueAfter(db, b.id, a.id);
    expect(moved.map((run) => run.id)).toEqual([c.id]);
    expect(expectOk(await getRun(db, c.id)).afterRunId).toBe(a.id);
  });

  test("listRuns pages newest first and filters by activity", async () => {
    const { chat, db, newRun, say } = await setup();
    const question = await say("q", null);
    const first = await newRun(question.id);
    const second = await newRun(question.id);
    expectOk(
      await transitionRun(db, first.id, { cancelledBy: null, type: "cancel" })
    );
    const page = expectOk(await listRuns(db, chat.id, { limit: 1 }));
    expect(page.items.map((run) => run.id)).toEqual([second.id]);
    const next = expectOk(
      await listRuns(db, chat.id, { cursor: page.nextCursor ?? "", limit: 1 })
    );
    expect(next.items.map((run) => run.id)).toEqual([first.id]);
    const active = expectOk(
      await listRuns(db, chat.id, { active: true, limit: 10 })
    );
    expect(active.items.map((run) => run.id)).toEqual([second.id]);
    expect((await listRuns(db, chat.id, { cursor: "junk", limit: 1 })).ok).toBe(
      false
    );
  });

  test("setRunResolvedModel records the routed model", async () => {
    const { db, newRun, say } = await setup();
    const run = await newRun((await say("q", null)).id);
    const updated = expectOk(
      await setRunResolvedModel(db, run.id, "openai:gpt-5")
    );
    expect(updated.resolvedModel).toBe("openai:gpt-5");
  });
});

describe("messages", () => {
  test("deleteMessage takes the subtree with it", async () => {
    const { chat, db, say } = await setup();
    const root = await say("root", null);
    await say("child", root.id);
    const other = await say("other root", null);
    expectOk(await deleteMessage(db, root.id));
    expect((await getMessageTree(db, chat.id)).map((node) => node.id)).toEqual([
      other.id,
    ]);
    expect((await deleteMessage(db, root.id)).ok).toBe(false);
  });

  test("listMessages pages oldest first", async () => {
    const { chat, db, say } = await setup();
    const one = await say("one", null);
    const two = await say("two", one.id);
    const page = expectOk(await listMessages(db, chat.id, { limit: 1 }));
    expect(page.items.map((row) => row.id)).toEqual([one.id]);
    const next = expectOk(
      await listMessages(db, chat.id, {
        cursor: page.nextCursor ?? "",
        limit: 1,
      })
    );
    expect(next.items.map((row) => row.id)).toEqual([two.id]);
    expect(next.nextCursor).toBeNull();
  });
});

describe("contexts and participants", () => {
  test("personalOrgOf and teamLineage", async () => {
    const { db, org, owner } = await setup();
    expect(await personalOrgOf(db, owner.id)).toBe(org.id);
    expect(await personalOrgOf(db, (await seedUser(db)).id)).toBeNull();
    const work = await seedOrg(db, owner.id);
    const eng = await seedTeam(db, work.id);
    const platform = await seedTeam(db, work.id, eng.id);
    expect(await teamLineage(db, platform.id)).toEqual({
      orgId: work.id,
      path: [platform.id, eng.id],
    });
  });

  test("listParticipants reads permissions from ownership and user grants", async () => {
    const { chat, db, owner } = await setup();
    const editor = await seedUser(db);
    await upsertGrant(db, {
      grantedBy: owner.id,
      permission: "editor",
      principal: { id: editor.id, type: "user" },
      resource: { resourceId: chat.id, resourceType: "conversation" },
    });
    await setParticipantState(db, chat.id, editor.id, {});
    const participants = await listParticipants(db, chat.id);
    expect(participants.map((p) => [p.userId, p.permission])).toEqual([
      [owner.id, "owner"],
      [editor.id, "editor"],
    ]);
  });
});
