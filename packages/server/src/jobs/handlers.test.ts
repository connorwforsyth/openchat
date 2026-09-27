import type { UserId } from "@workspace/contract/schemas/common";
import {
  createConversation,
  getConversation,
} from "@workspace/db/queries/conversations";
import { upsertGrant } from "@workspace/db/queries/grants";
import {
  createTestDb,
  seedOrg,
  seedUser,
  type TestDb,
} from "@workspace/db/testing";
import { newId } from "@workspace/shared/ids";
import { ok } from "@workspace/shared/result";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { actorFor } from "../context";
import type { StreamChannel } from "../ports/stream-channel";
import { coreJobHandlers, shouldTitle } from "./handlers";

// `title.generate` writes as the system (ticket 034): only a chat's owner
// or an editor may get it named, when it's enqueued and again when it runs.

let testDb: TestDb;
beforeAll(async () => {
  testDb = await createTestDb();
});
afterAll(() => testDb.close());

/** A user with a personal space, as sign-up leaves them. */
const someone = async (): Promise<UserId> => {
  const row = await seedUser(testDb.db);
  await seedOrg(testDb.db, row.id, { isPersonal: true });
  return row.id;
};

const setup = async () => {
  const { db } = testDb;
  const owner = (await seedUser(db)).id;
  const personal = await seedOrg(db, owner, { isPersonal: true });
  const chat = await createConversation(db, {
    context: { id: personal.id, type: "personal" },
    ownerId: owner,
  });
  const share = async (permission: "viewer" | "editor") => {
    const user = await someone();
    await upsertGrant(db, {
      grantedBy: owner,
      permission,
      principal: { id: user, type: "user" },
      resource: { resourceId: chat.id, resourceType: "conversation" },
    });
    return user;
  };
  const titleModel = vi.fn(() => Promise.resolve(null));
  const handlers = coreJobHandlers({
    db,
    streams: {} as StreamChannel,
    titleModel,
  });
  const title = (userId: UserId) =>
    handlers["title.generate"]?.(
      {
        completedAt: null,
        createdAt: new Date().toISOString(),
        data: { conversationId: chat.id, userId },
        id: newId("job"),
        name: "title.generate",
        output: null,
        retryCount: 0,
        singletonKey: null,
        startAfter: new Date().toISOString(),
        state: "active",
      },
      new AbortController().signal
    );
  return { chat, owner, share, title, titleModel };
};

describe("title.generate access", () => {
  it("is only enqueued for someone who may rename the chat", async () => {
    const { chat, owner, share } = await setup();
    const { db } = testDb;
    expect(await shouldTitle(db, chat.id, owner)).toBe(true);
    expect(await shouldTitle(db, chat.id, await share("editor"))).toBe(true);
    expect(await shouldTitle(db, chat.id, await share("viewer"))).toBe(false);
    expect(await shouldTitle(db, chat.id, await someone())).toBe(false);
  });

  it("won't name a chat for a viewer when it runs", async () => {
    const { chat, owner, share, title, titleModel } = await setup();
    const viewer = await share("viewer");
    expect(await title(viewer)).toEqual(ok({ skipped: "forbidden" }));
    expect(titleModel).not.toHaveBeenCalled();

    // The owner gets as far as asking for a model (there's none here).
    expect(await title(owner)).toEqual(ok({ skipped: "no_model" }));
    expect(titleModel).toHaveBeenCalledOnce();
    const actor = await actorFor(testDb.db, { userId: owner });
    const seen = await getConversation(testDb.db, chat.id, actor);
    expect(seen.ok && seen.value.title).toBeNull();
  });
});
