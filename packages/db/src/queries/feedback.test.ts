import { feedbackSchema } from "@workspace/contract/schemas/feedback";
import type { AgentDefinition } from "@workspace/contract/schemas/library";
import { newId } from "@workspace/shared/ids";
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
  deleteFeedback,
  feedbackTotals,
  getFeedback,
  setFeedback,
  toFeedback,
} from "./feedback";
import { createVersionedItem, publishDraft } from "./library";
import { insertMessage } from "./messages";

let testDb: TestDb;
beforeAll(async () => {
  testDb = await createTestDb();
});
afterAll(() => testDb.close());

const definition: AgentDefinition = {
  approvals: { default: "auto", tools: {} },
  conversationStarters: [],
  instructions: "Be brief.",
  kind: "agent",
  knowledgeFileIds: [],
  mcpServers: [],
  model: "fast",
  parameters: {},
  sandboxProvider: null,
  skills: [],
  tools: [],
};

describe("feedback", () => {
  test("one rating per user per message, totals per agent", async () => {
    const { db } = testDb;
    const owner = await seedUser(db);
    const friend = await seedUser(db);
    const org = await seedOrg(db, owner.id, { isPersonal: true });
    const { item } = await createVersionedItem(db, "agent", {
      createdBy: owner.id,
      definition,
      name: "Brief",
      owner: { id: owner.id, type: "user" },
    });
    const { version } = expectOk(
      await publishDraft(db, "agent", item.id, { publishedBy: owner.id })
    );
    const chat = await createConversation(db, {
      context: { id: org.id, type: "personal" },
      ownerId: owner.id,
    });
    const answer = expectOk(
      await insertMessage(db, {
        agent: { id: item.id, versionId: version.id },
        authorId: null,
        conversationId: chat.id,
        parentId: null,
        parts: [{ text: "Done.", type: "text" }],
        role: "assistant",
      })
    );

    const first = expectOk(
      await setFeedback(db, {
        messageId: answer.id,
        rating: "down",
        userId: owner.id,
      })
    );
    const replaced = expectOk(
      await setFeedback(db, {
        comment: "Actually fine",
        messageId: answer.id,
        rating: "up",
        shareWithMaintainers: true,
        userId: owner.id,
      })
    );
    expect(replaced.id).toBe(first.id);
    expectOk(
      await setFeedback(db, {
        messageId: answer.id,
        rating: "up",
        userId: friend.id,
      })
    );
    expect(await feedbackTotals(db, item.id)).toEqual({ down: 0, up: 2 });

    const mine = await getFeedback(db, answer.id, owner.id);
    expect(mine && feedbackSchema.parse(toFeedback(mine))).toMatchObject({
      comment: "Actually fine",
      shareWithMaintainers: true,
    });
    expect(await deleteFeedback(db, answer.id, friend.id)).toBe(true);
    expect(await deleteFeedback(db, answer.id, friend.id)).toBe(false);
    expect(await getFeedback(db, answer.id, friend.id)).toBeNull();
    expect(
      await setFeedback(db, {
        messageId: newId("message"),
        rating: "up",
        userId: owner.id,
      })
    ).toMatchObject({ error: { type: "not_found" } });
  });
});
