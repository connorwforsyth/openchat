import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite-pgvector";
import type {
  ConversationId,
  UserId,
} from "@workspace/contract/schemas/common";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

import type { Db } from "../client";
import { MIGRATIONS_FOLDER } from "../migrator";
import { relations } from "../schema/relations";
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
  artifactAccessOf,
  attachArtifactToChat,
  deleteArtifact,
  duplicateArtifact,
  getArtifact,
  getArtifactGrant,
  listArtifactGrants,
  listArtifactPage,
  listArtifactVersions,
  listChatArtifacts,
  markArtifactViewed,
  renameArtifact,
  saveArtifactVersion,
  saveEditedArtifactVersion,
  toArtifactVersion,
  upsertArtifactGrant,
} from "./artifacts";
import { createConversation } from "./conversations";
import { insertMessage } from "./messages";
import { loadPrincipals } from "./teams";

// The Artifacts page's queries (124): owners, shares, the per-person "last
// viewed", use in another chat, and the migration that gave existing rows
// an owner.

let testDb: TestDb;
let db: Db;
beforeAll(async () => {
  testDb = await createTestDb();
  ({ db } = testDb);
});
afterAll(() => testDb.close());

const chatFor = async (ownerId: UserId) => {
  const personal = await seedOrg(db, ownerId, { isPersonal: true });
  const chat = await createConversation(db, {
    context: { id: personal.id, type: "personal" },
    ownerId,
  });
  const message = expectOk(
    await insertMessage(db, {
      authorId: null,
      conversationId: chat.id,
      parentId: null,
      parts: [{ text: "Here you go", type: "text" }],
      role: "assistant",
    })
  );
  return { chat, message };
};

const makeArtifact = async (
  ownerId: UserId,
  values: {
    readonly content?: string;
    readonly kind?: "markdown" | "html" | "document";
  } = {}
) => {
  const { chat, message } = await chatFor(ownerId);
  const saved = expectOk(
    await saveArtifactVersion(db, {
      content: values.content ?? "Day one: the harbour.",
      conversationId: chat.id,
      kind: values.kind ?? "markdown",
      messageId: message.id,
      title: "Trip plan",
    })
  );
  return { ...saved, chat, message };
};

const actorOf = async (userId: UserId) => ({
  principals: await loadPrincipals(db, userId),
  userId,
});

describe("owners", () => {
  test("a new artifact belongs to its chat's owner, and each version records its chat", async () => {
    const ada = await seedUser(db);
    const { artifact, chat, version } = await makeArtifact(ada.id);
    expect(artifact.ownerId).toBe(ada.id);
    expect(version.conversationId).toBe(chat.id);
  });
});

describe("shares", () => {
  test("a share to a team reaches its members, and sharing again replaces the level", async () => {
    const ada = await seedUser(db);
    const ben = await seedUser(db);
    const org = await seedOrg(db, ada.id);
    const eng = await seedTeam(db, org.id);
    const platform = await seedTeam(db, org.id, eng.id);
    await db.insert(teamMember).values({ teamId: platform.id, userId: ben.id });
    const { artifact } = await makeArtifact(ada.id);

    expect(await artifactAccessOf(db, artifact.id, await actorOf(ben.id))).toBe(
      null
    );
    await upsertArtifactGrant(db, {
      artifactId: artifact.id,
      grantedBy: ada.id,
      permission: "viewer",
      principal: { id: eng.id, type: "team" },
    });
    expect(await artifactAccessOf(db, artifact.id, await actorOf(ben.id))).toBe(
      "viewer"
    );
    const again = await upsertArtifactGrant(db, {
      artifactId: artifact.id,
      grantedBy: ada.id,
      permission: "editor",
      principal: { id: eng.id, type: "team" },
    });
    expect(await listArtifactGrants(db, artifact.id)).toHaveLength(1);
    expect(again.permission).toBe("editor");
    expect(await artifactAccessOf(db, artifact.id, await actorOf(ben.id))).toBe(
      "editor"
    );
    expect(await artifactAccessOf(db, artifact.id, await actorOf(ada.id))).toBe(
      "owner"
    );
    expect((await getArtifactGrant(db, artifact.id, again.id)).ok).toBe(true);
  });
});

describe("the page", () => {
  test("scopes, kind and search filter; last viewed sorts first", async () => {
    const ada = await seedUser(db);
    const ben = await seedUser(db);
    const own = await makeArtifact(ada.id);
    const page = await makeArtifact(ada.id, {
      content: "<p>Welcome aboard</p>",
      kind: "html",
    });
    const bens = await makeArtifact(ben.id, { content: "Ben's notes" });
    await upsertArtifactGrant(db, {
      artifactId: bens.artifact.id,
      grantedBy: ben.id,
      permission: "viewer",
      principal: { id: ada.id, type: "user" },
    });
    const actor = await actorOf(ada.id);
    const ids = async (
      filter: Partial<Parameters<typeof listArtifactPage>[1]>
    ) =>
      (
        await listArtifactPage(db, {
          actor,
          limit: 50,
          scope: "all",
          ...filter,
        })
      ).items.map((row) => row.artifact.id);

    expect(await ids({ scope: "mine" })).toEqual(
      expect.arrayContaining([own.artifact.id, page.artifact.id])
    );
    expect(await ids({ scope: "mine" })).not.toContain(bens.artifact.id);
    expect(await ids({ scope: "shared" })).toEqual([bens.artifact.id]);
    expect(await ids({ kind: "html" })).toEqual([page.artifact.id]);
    expect(await ids({ query: "aboard" })).toEqual([page.artifact.id]);
    expect(await ids({ query: "50%" })).toEqual([]);

    // Viewing the oldest puts it first; the shared one says who owns it.
    await markArtifactViewed(
      db,
      own.artifact.id,
      ada.id,
      new Date(Date.now() + 60_000)
    );
    const all = await listArtifactPage(db, { actor, limit: 50, scope: "all" });
    expect(all.items[0]?.artifact.id).toBe(own.artifact.id);
    expect(all.items[0]?.viewedAt).not.toBeNull();
    const shared = all.items.find(
      (row) => row.artifact.id === bens.artifact.id
    );
    expect(shared).toMatchObject({
      access: "viewer",
      ownerName: ben.name,
      viewedAt: null,
    });
    expect(
      all.items.find((row) => row.artifact.id === page.artifact.id)?.shared
    ).toBe(false);
  });

  test("pages by a cursor without repeats", async () => {
    const cy = await seedUser(db);
    for (let index = 0; index < 3; index += 1) {
      // biome-ignore lint/performance/noAwaitInLoops: distinct update times.
      await makeArtifact(cy.id);
    }
    const actor = await actorOf(cy.id);
    const first = await listArtifactPage(db, {
      actor,
      limit: 2,
      scope: "mine",
    });
    expect(first.items).toHaveLength(2);
    expect(first.nextCursor).not.toBeNull();
    const { decodeCursor } = await import("./page");
    const after = expectOk(decodeCursor(first.nextCursor ?? ""));
    const second = await listArtifactPage(db, {
      actor,
      after,
      limit: 2,
      scope: "mine",
    });
    expect(second.items).toHaveLength(1);
    expect(second.nextCursor).toBeNull();
    const seen = [...first.items, ...second.items].map(
      (row) => row.artifact.id
    );
    expect(new Set(seen).size).toBe(3);
  });
});

describe("rename, duplicate and delete", () => {
  test("a duplicate is a new, unshared artifact with the latest content", async () => {
    const ada = await seedUser(db);
    const ben = await seedUser(db);
    const { artifact } = await makeArtifact(ada.id);
    expectOk(await renameArtifact(db, artifact.id, "Holiday plan"));
    const copy = expectOk(
      await duplicateArtifact(db, artifact.id, ben.id, "Holiday plan (copy)")
    );
    expect(copy).toMatchObject({
      ownerId: ben.id,
      title: "Holiday plan (copy)",
    });
    const [version] = await listArtifactVersions(db, copy.id);
    expect(version).toMatchObject({
      content: "Day one: the harbour.",
      number: 1,
    });
    expect(await listArtifactGrants(db, copy.id)).toEqual([]);

    await upsertArtifactGrant(db, {
      artifactId: artifact.id,
      grantedBy: ada.id,
      permission: "viewer",
      principal: { id: ben.id, type: "user" },
    });
    expect(await deleteArtifact(db, artifact.id)).toBe(true);
    expect((await getArtifact(db, artifact.id)).ok).toBe(false);
    expect(await listArtifactGrants(db, artifact.id)).toEqual([]);
    expect(await deleteArtifact(db, artifact.id)).toBe(false);
  });
});

describe("use in chat", () => {
  test("a chat it's used in lists it and can save its next version", async () => {
    const ada = await seedUser(db);
    const { artifact } = await makeArtifact(ada.id);
    const other = await chatFor(ada.id);

    // Not attached yet: that chat can't version it.
    const refused = await saveArtifactVersion(db, {
      artifactId: artifact.id,
      content: "Day two: the hills.",
      conversationId: other.chat.id,
      kind: "markdown",
      messageId: other.message.id,
      title: "Trip plan",
    });
    expect(refused.ok).toBe(false);

    await attachArtifactToChat(db, {
      addedBy: ada.id,
      artifactId: artifact.id,
      conversationId: other.chat.id,
    });
    await attachArtifactToChat(db, {
      addedBy: ada.id,
      artifactId: artifact.id,
      conversationId: other.chat.id,
    });
    expect(
      (await listChatArtifacts(db, other.chat.id)).map((row) => row.id)
    ).toEqual([artifact.id]);

    const saved = expectOk(
      await saveArtifactVersion(db, {
        artifactId: artifact.id,
        content: "Day two: the hills.",
        conversationId: other.chat.id,
        kind: "markdown",
        messageId: other.message.id,
        title: "Trip plan",
      })
    );
    expect(saved.version).toMatchObject({
      conversationId: other.chat.id,
      number: 2,
    });
    expect(saved.artifact.conversationId).not.toBe(other.chat.id);
  });
});

describe("a person's edit (126)", () => {
  test("saves the next version on the latest, keeping its chat and message, and records who", async () => {
    const ada = await seedUser(db);
    const { artifact, chat, message, version } = await makeArtifact(ada.id, {
      content: '{"type":"doc","content":[]}',
      kind: "document",
    });
    const saved = expectOk(
      await saveEditedArtifactVersion(db, {
        artifactId: artifact.id,
        baseVersionId: version.id,
        content: '{"type":"doc","content":[{"type":"paragraph"}]}',
        editedBy: ada.id,
      })
    );
    expect(saved.version).toMatchObject({
      conversationId: chat.id,
      editedBy: ada.id,
      messageId: message.id,
      number: 2,
    });
    expect(saved.artifact.latestVersionId).toBe(saved.version.id);
    expect(toArtifactVersion(saved.version).editedBy).toBe(ada.id);
    // A run's version names nobody.
    expect(toArtifactVersion(version).editedBy).toBeNull();
  });

  test("refuses an edit of a version that's no longer the latest", async () => {
    const ada = await seedUser(db);
    const { artifact, version } = await makeArtifact(ada.id);
    expectOk(
      await saveEditedArtifactVersion(db, {
        artifactId: artifact.id,
        baseVersionId: version.id,
        content: "Mine",
        editedBy: ada.id,
      })
    );
    const stale = await saveEditedArtifactVersion(db, {
      artifactId: artifact.id,
      baseVersionId: version.id,
      content: "Theirs",
      editedBy: ada.id,
    });
    expect(stale).toEqual({
      error: { type: "version_mismatch" },
      ok: false,
    });
    expect(await listArtifactVersions(db, artifact.id)).toHaveLength(2);
  });
});

describe("the 124 migration", () => {
  test("gives existing artifacts their chat's owner and versions their chat", async () => {
    // Migrate to just before 124, write an artifact the old way, then apply 124.
    const before = await mkdtemp(join(tmpdir(), "artifacts-migration-"));
    try {
      await cp(MIGRATIONS_FOLDER, before, { recursive: true });
      const { readdir } = await import("node:fs/promises");
      const latest = (await readdir(before)).find((name) =>
        name.endsWith("_artifacts_page")
      );
      expect(latest).toBeDefined();
      await rm(join(before, latest ?? ""), { force: true, recursive: true });

      const client = await PGlite.create({ extensions: { vector } });
      const old = drizzle({ client, relations }) as unknown as Db;
      await migrate(drizzle({ client }), { migrationsFolder: before });
      const owner = await seedUser(old);
      const personal = await seedOrg(old, owner.id, { isPersonal: true });
      const chat = await createConversation(old, {
        context: { id: personal.id, type: "personal" },
        ownerId: owner.id,
      });
      const message = expectOk(
        await insertMessage(old, {
          authorId: null,
          conversationId: chat.id,
          parentId: null,
          parts: [{ text: "Here", type: "text" }],
          role: "assistant",
        })
      );
      await client.query(
        `insert into artifact (id, conversation_id, kind, message_id, title)
         values ('0199a000-0000-7000-8000-000000000001', $1, 'markdown', $2, 'Old')`,
        [chat.id, message.id]
      );
      await client.query(
        `insert into artifact_version (id, artifact_id, content, message_id, number)
         values ('0199a000-0000-7000-8000-000000000002', '0199a000-0000-7000-8000-000000000001', 'x', $1, 1)`,
        [message.id]
      );

      await migrate(drizzle({ client }), {
        migrationsFolder: MIGRATIONS_FOLDER,
      });
      const artifacts = await client.query<{ owner_id: string }>(
        "select owner_id from artifact"
      );
      expect(artifacts.rows).toEqual([{ owner_id: owner.id }]);
      const versions = await client.query<{ conversation_id: ConversationId }>(
        "select conversation_id from artifact_version"
      );
      expect(versions.rows).toEqual([{ conversation_id: chat.id }]);
      await client.close();
    } finally {
      await rm(before, { force: true, recursive: true });
    }
  });
});
