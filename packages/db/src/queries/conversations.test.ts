import type { MessageId, UserId } from "@workspace/contract/schemas/common";
import { searchHitSchema } from "@workspace/contract/schemas/search";
import { newId } from "@workspace/shared/ids";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { teamMember } from "../schema/tenancy";
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
  deleteConversation,
  deleteStaleTestChats,
  getConversation,
  getConversationWithBranch,
  listConversations,
  parseHeadline,
  searchConversations,
  setConversationContext,
  setParticipantState,
  toChatContext,
  updateConversation,
  type Viewer,
} from "./conversations";
import { createShareLink, listGrantsForResource, upsertGrant } from "./grants";
import { insertMessage } from "./messages";
import { loadPrincipals } from "./teams";

let testDb: TestDb;
beforeAll(async () => {
  testDb = await createTestDb();
});
afterAll(() => testDb.close());

const viewerOf = async (userId: UserId): Promise<Viewer> => ({
  principals: await loadPrincipals(testDb.db, userId),
  userId,
});

const setup = async () => {
  const { db } = testDb;
  const owner = await seedUser(db);
  const personal = await seedOrg(db, owner.id, { isPersonal: true });
  const newChat = (title?: string) =>
    createConversation(db, {
      context: { id: personal.id, type: "personal" },
      ownerId: owner.id,
      title,
    });
  const say = (
    conversationId: typeof chat.id,
    parentId: MessageId | null,
    text: string
  ) =>
    insertMessage(db, {
      authorId: owner.id,
      conversationId,
      parentId,
      parts: [{ text, type: "text" }],
      role: "user",
    }).then(expectOk);
  const chat = await newChat("First chat");
  return { chat, db, newChat, owner, personal, say };
};

describe("access", () => {
  test("the owner reads it; a stranger gets not_found until granted", async () => {
    const { chat, db, owner } = await setup();
    const stranger = await seedUser(db);

    const mine = expectOk(
      await getConversation(db, chat.id, await viewerOf(owner.id))
    );
    expect(mine).toMatchObject({
      activeLeafId: null,
      myPermission: "owner",
      title: "First chat",
      visibility: "private",
    });

    expect(
      await getConversation(db, chat.id, await viewerOf(stranger.id))
    ).toMatchObject({
      error: { type: "not_found" },
    });

    expectOk(
      await upsertGrant(db, {
        grantedBy: owner.id,
        permission: "viewer",
        principal: { id: stranger.id, type: "user" },
        resource: { resourceId: chat.id, resourceType: "conversation" },
      })
    );
    const shared = expectOk(
      await getConversation(db, chat.id, await viewerOf(stranger.id))
    );
    expect(shared).toMatchObject({
      myPermission: "viewer",
      visibility: "shared",
    });
  });

  test("a grant to a parent team reaches members of a sub-team", async () => {
    const { chat, db, owner } = await setup();
    const org = await seedOrg(db, owner.id);
    const engineering = await seedTeam(db, org.id);
    const platform = await seedTeam(db, org.id, engineering.id);
    const colleague = await seedUser(db);
    await db.insert(teamMember).values({
      teamId: platform.id,
      userId: colleague.id,
    });
    expectOk(
      await upsertGrant(db, {
        grantedBy: owner.id,
        permission: "editor",
        principal: { id: engineering.id, type: "team" },
        resource: { resourceId: chat.id, resourceType: "conversation" },
      })
    );
    const view = expectOk(
      await getConversation(db, chat.id, await viewerOf(colleague.id))
    );
    expect(view.myPermission).toBe("editor");
  });

  test("an active share link makes it public-link", async () => {
    const { chat, db, owner } = await setup();
    await createShareLink(db, {
      createdBy: owner.id,
      resource: { resourceId: chat.id, resourceType: "conversation" },
      token: "a-share-token-that-is-long-enough",
    });
    const view = expectOk(
      await getConversation(db, chat.id, await viewerOf(owner.id))
    );
    expect(view.visibility).toBe("public-link");
  });
});

describe("listConversations", () => {
  test("pages by recent activity with filters", async () => {
    const { chat, db, newChat, owner, say } = await setup();
    const second = await newChat("Second");
    const third = await newChat("Third");
    await say(chat.id, null, "bump the first one");
    const viewer = await viewerOf(owner.id);

    const page1 = expectOk(await listConversations(db, viewer, { limit: 2 }));
    expect(page1.items.map((c) => c.id)).toEqual([chat.id, third.id]);
    expect(page1.nextCursor).not.toBeNull();
    const page2 = expectOk(
      await listConversations(db, viewer, {
        cursor: page1.nextCursor ?? undefined,
        limit: 2,
      })
    );
    expect(page2.items.map((c) => c.id)).toEqual([second.id]);
    expect(page2.nextCursor).toBeNull();

    await setParticipantState(db, second.id, owner.id, { pinned: true });
    const pinned = expectOk(
      await listConversations(db, viewer, { limit: 10, pinned: true })
    );
    expect(pinned.items.map((c) => c.id)).toEqual([second.id]);

    expectOk(await updateConversation(db, third.id, { archived: true }));
    const archived = expectOk(
      await listConversations(db, viewer, { archived: true, limit: 10 })
    );
    expect(archived.items.map((c) => c.id)).toEqual([third.id]);

    expect(
      await listConversations(db, viewer, { cursor: "nope", limit: 2 })
    ).toMatchObject({
      error: { type: "invalid_cursor" },
    });
  });

  test("separates mine from shared", async () => {
    const { chat, db, owner } = await setup();
    const friend = await seedUser(db);
    const friendsOrg = await seedOrg(db, friend.id, { isPersonal: true });
    const theirs = await createConversation(db, {
      context: { id: friendsOrg.id, type: "personal" },
      ownerId: friend.id,
    });
    expectOk(
      await upsertGrant(db, {
        grantedBy: friend.id,
        permission: "viewer",
        principal: { id: owner.id, type: "user" },
        resource: { resourceId: theirs.id, resourceType: "conversation" },
      })
    );
    const viewer = await viewerOf(owner.id);
    const ids = async (ownership: "mine" | "shared" | "all") =>
      expectOk(
        await listConversations(db, viewer, { limit: 10, ownership })
      ).items.map((c) => c.id);
    expect(await ids("mine")).toEqual([chat.id]);
    expect(await ids("shared")).toEqual([theirs.id]);
    expect(new Set(await ids("all"))).toEqual(new Set([chat.id, theirs.id]));
  });
});

describe("context and state", () => {
  test("the context can change until the first message", async () => {
    const { chat, db, owner, say } = await setup();
    const org = await seedOrg(db, owner.id);
    const moved = expectOk(
      await setConversationContext(db, chat.id, { id: org.id, type: "org" })
    );
    expect(moved.contextType).toBe("org");
    await say(chat.id, null, "first");
    expect(
      await setConversationContext(db, chat.id, { id: org.id, type: "org" })
    ).toMatchObject({ error: { reason: "context_locked", type: "conflict" } });
    expect(
      await setConversationContext(db, newId("conversation"), {
        id: org.id,
        type: "org",
      })
    ).toMatchObject({ error: { type: "not_found" } });
  });

  test("the branch follows the active leaf, else the newest", async () => {
    const { chat, db, owner, say } = await setup();
    const viewer = await viewerOf(owner.id);
    const empty = expectOk(
      await getConversationWithBranch(db, chat.id, viewer)
    );
    expect(empty.branch).toEqual({ leafId: null, messages: [], siblings: [] });

    const root = await say(chat.id, null, "root");
    const left = await say(chat.id, root.id, "left");
    const right = await say(chat.id, root.id, "right");
    const newest = expectOk(
      await getConversationWithBranch(db, chat.id, viewer)
    );
    expect(newest.branch.leafId).toBe(right.id);

    await setParticipantState(db, chat.id, owner.id, { activeLeafId: left.id });
    const active = expectOk(
      await getConversationWithBranch(db, chat.id, viewer)
    );
    expect(active.branch.messages.map((m) => m.id)).toEqual([root.id, left.id]);

    const explicit = expectOk(
      await getConversationWithBranch(db, chat.id, viewer, right.id)
    );
    expect(explicit.branch.leafId).toBe(right.id);
  });

  test("deleting removes grants too", async () => {
    const { chat, db, owner } = await setup();
    const friend = await seedUser(db);
    expectOk(
      await upsertGrant(db, {
        grantedBy: owner.id,
        permission: "editor",
        principal: { id: friend.id, type: "user" },
        resource: { resourceId: chat.id, resourceType: "conversation" },
      })
    );
    expectOk(await deleteConversation(db, chat.id));
    expect(
      await listGrantsForResource(db, {
        resourceId: chat.id,
        resourceType: "conversation",
      })
    ).toEqual([]);
    expect(await deleteConversation(db, chat.id)).toMatchObject({
      error: { type: "not_found" },
    });
  });

  test("toChatContext hides the personal org", () => {
    const orgId = newId("org");
    expect(toChatContext({ id: orgId, type: "personal" })).toEqual({
      type: "personal",
    });
    expect(toChatContext({ id: orgId, type: "org" })).toEqual({
      id: orgId,
      type: "org",
    });
  });
});

describe("search", () => {
  test("finds titles and message text the viewer can read", async () => {
    const { chat, db, newChat, owner, say } = await setup();
    const other = await newChat("Weekend plans");
    await say(other.id, null, "Remember the zucchini bread recipe");
    await say(chat.id, null, "nothing to see");
    const stranger = await seedUser(db);

    const hits = expectOk(
      await searchConversations(db, await viewerOf(owner.id), {
        limit: 10,
        query: "zucchini",
      })
    );
    expect(hits.items).toHaveLength(1);
    const [hit] = hits.items;
    expect(searchHitSchema.parse(hit)).toEqual(hit);
    expect(hit).toMatchObject({
      conversationId: other.id,
      role: "user",
      title: "Weekend plans",
    });
    const span = hit?.highlights[0];
    expect(span && hit?.snippet.slice(span.start, span.end)).toBe("zucchini");

    const titleHits = expectOk(
      await searchConversations(db, await viewerOf(owner.id), {
        limit: 10,
        query: "weekend",
      })
    );
    expect(titleHits.items[0]).toMatchObject({
      conversationId: other.id,
      messageId: null,
    });

    const none = expectOk(
      await searchConversations(db, await viewerOf(stranger.id), {
        limit: 10,
        query: "zucchini",
      })
    );
    expect(none.items).toEqual([]);
  });

  test("pages with an offset cursor", async () => {
    const { db, newChat, owner, say } = await setup();
    for (const n of [1, 2, 3]) {
      // biome-ignore lint/performance/noAwaitInLoops: rows are created in order on purpose.
      const c = await newChat(`Chat ${n}`);
      await say(c.id, null, `kumquat number ${n}`);
    }
    const viewer = await viewerOf(owner.id);
    const first = expectOk(
      await searchConversations(db, viewer, { limit: 2, query: "kumquat" })
    );
    expect(first.items).toHaveLength(2);
    const rest = expectOk(
      await searchConversations(db, viewer, {
        cursor: first.nextCursor ?? undefined,
        limit: 2,
        query: "kumquat",
      })
    );
    expect(rest.items).toHaveLength(1);
    expect(rest.nextCursor).toBeNull();
    expect(
      await searchConversations(db, viewer, {
        cursor: "bad!",
        limit: 2,
        query: "x",
      })
    ).toMatchObject({ error: { type: "invalid_cursor" } });
  });

  test("parseHeadline turns markers into offsets", () => {
    expect(parseHeadline("a \u0002b\u0003 c \u0002dé\u0003")).toEqual({
      highlights: [
        { end: 3, start: 2 },
        { end: 8, start: 6 },
      ],
      snippet: "a b c dé",
    });
  });
});

describe("builder test chats", () => {
  const testChat = (
    { db, owner, personal }: Awaited<ReturnType<typeof setup>>,
    title: string
  ) =>
    createConversation(db, {
      context: { id: personal.id, type: "personal" },
      ownerId: owner.id,
      purpose: "test",
      title,
    });

  test("stay out of the list and search, but open by id", async () => {
    const seeded = await setup();
    const { chat, db, owner, say } = seeded;
    const scratch = await testChat(seeded, "Agent test");
    await say(scratch.id, null, "a quokka walks into the builder");
    const viewer = await viewerOf(owner.id);

    const listed = expectOk(await listConversations(db, viewer, { limit: 10 }));
    expect(listed.items.map((c) => c.id)).toEqual([chat.id]);
    const archived = expectOk(
      await listConversations(db, viewer, { archived: true, limit: 10 })
    );
    expect(archived.items).toEqual([]);
    // Message text and title, each of which would otherwise match.
    const searches = await Promise.all(
      ["quokka", "agent test"].map((query) =>
        searchConversations(db, viewer, { limit: 10, query })
      )
    );
    expect(searches.map((found) => expectOk(found).items)).toEqual([[], []]);
    expect(
      expectOk(await getConversation(db, scratch.id, viewer))
    ).toMatchObject({ id: scratch.id, purpose: "test" });
  });

  test("the cleanup deletes idle ones only", async () => {
    const seeded = await setup();
    const { chat, db, owner } = seeded;
    const idle = await testChat(seeded, "Idle test");
    const fresh = await testChat(seeded, "Fresh test");
    expectOk(
      await upsertGrant(db, {
        grantedBy: owner.id,
        permission: "viewer",
        principal: { id: (await seedUser(db)).id, type: "user" },
        resource: { resourceId: idle.id, resourceType: "conversation" },
      })
    );
    // The database is shared by every test here, so "idle" is half a year back:
    // nothing else is that old.
    const cutoff = new Date(Date.now() - 180 * 24 * 3600 * 1000);
    await db.execute(
      sql`update conversation set created_at = ${new Date(cutoff.getTime() - 60_000).toISOString()}::timestamptz where id = ${idle.id}`
    );

    expect(await deleteStaleTestChats(db, cutoff)).toBe(1);
    const viewer = await viewerOf(owner.id);
    expect(await getConversation(db, idle.id, viewer)).toMatchObject({
      ok: false,
    });
    expect(
      await listGrantsForResource(db, {
        resourceId: idle.id,
        resourceType: "conversation",
      })
    ).toEqual([]);
    // Ordinary chats are never cleaned up, however old.
    expectOk(await getConversation(db, fresh.id, viewer));
    expectOk(await getConversation(db, chat.id, viewer));
  });
});
