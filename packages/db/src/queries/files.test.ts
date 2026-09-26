import { fileSchema } from "@workspace/contract/schemas/files";
import { newId } from "@workspace/shared/ids";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

import {
  createTestDb,
  expectOk,
  seedOrg,
  seedUser,
  type TestDb,
} from "../testing";
import { createConversation, type Viewer } from "./conversations";
import {
  createFile,
  deleteFile,
  getFile,
  getReadableFile,
  listChunks,
  listFileIdsToReindex,
  listFiles,
  listFilesToReindex,
  listReadableIndexedFileIds,
  replaceChunks,
  searchChunks,
  setFileState,
  toFileRecord,
} from "./files";
import { upsertGrant } from "./grants";

let testDb: TestDb;
beforeAll(async () => {
  testDb = await createTestDb();
});
afterAll(() => testDb.close());

/** A unit vector along axis `i` (plus a little of axis 0), `size` long. */
const axis = (size: number, i: number, lean = 0): number[] =>
  Array.from({ length: size }, (_, j) => {
    if (j === i) {
      return 1;
    }
    return j === 0 ? lean : 0;
  });

const upload = async (name = "notes.txt") => {
  const { db } = testDb;
  const owner = await seedUser(db);
  const row = await createFile(db, {
    mediaType: "text/plain",
    name,
    ownerId: owner.id,
    purpose: "knowledge",
    size: 42,
    storageDriver: "local",
    storageKey: `uploads/${newId("x")}`,
  });
  return { db, owner, row };
};

describe("files", () => {
  test("moves through ingestion and maps to the contract", async () => {
    const { db, row } = await upload();
    expect(toFileRecord(row).status).toEqual({ state: "uploaded" });
    const processing = expectOk(await setFileState(db, row.id, "processing"));
    expect(fileSchema.parse(toFileRecord(processing)).status).toEqual({
      state: "processing",
    });
    const failed = expectOk(
      await setFileState(db, row.id, "failed", "Couldn't parse PDF")
    );
    expect(toFileRecord(failed).status).toEqual({
      message: "Couldn't parse PDF",
      state: "failed",
    });
    expect(await setFileState(db, newId("file"), "processing")).toMatchObject({
      error: { type: "not_found" },
    });
  });

  test("replaces chunks atomically and records the model", async () => {
    const { db, row } = await upload();
    const ready = expectOk(
      await replaceChunks(
        db,
        row.id,
        [
          { embedding: axis(768, 1), page: 1, text: "one" },
          { embedding: axis(768, 2), page: 2, text: "two" },
        ],
        "ollama:nomic-embed-text"
      )
    );
    expect(toFileRecord(ready).status).toEqual({
      chunkCount: 2,
      embeddingModel: "ollama:nomic-embed-text",
      state: "ready",
    });
    const chunks = await listChunks(db, row.id);
    expect(chunks.map((c) => [c.ordinal, c.dimensions, c.text])).toEqual([
      [0, 768, "one"],
      [1, 768, "two"],
    ]);
    expect(chunks[0]?.embedding?.[1]).toBe(1);

    expectOk(
      await replaceChunks(
        db,
        row.id,
        [{ embedding: null, text: "plain" }],
        null
      )
    );
    const again = expectOk(await getFile(db, row.id));
    expect(again).toMatchObject({ chunkCount: 1, embeddingModel: null });
    expect(await listFilesToReindex(db, "ollama:nomic-embed-text")).toContain(
      row.id
    );
    expect(await replaceChunks(db, newId("file"), [], null)).toMatchObject({
      error: { type: "not_found" },
    });
  });
});

describe("searchChunks", () => {
  test("ranks by cosine similarity within the given files and model", async () => {
    for (const size of [768, 5]) {
      // biome-ignore lint/performance/noAwaitInLoops: one indexed size, one unindexed, in turn.
      const { db, row } = await upload(`doc-${size}.txt`);
      const other = await upload("other.txt");
      expectOk(
        await replaceChunks(
          db,
          row.id,
          [
            { embedding: axis(size, 1), text: "cats" },
            { embedding: axis(size, 2), text: "dogs" },
            { embedding: axis(size, 1, 0.5), text: "kittens" },
          ],
          "test:embed"
        )
      );
      expectOk(
        await replaceChunks(
          db,
          other.row.id,
          [{ embedding: axis(size, 1), text: "not yours" }],
          "test:embed"
        )
      );
      const hits = await searchChunks(db, {
        embedding: axis(size, 1),
        fileIds: [row.id],
        limit: 2,
        model: "test:embed",
      });
      expect(hits.map((hit) => hit.text)).toEqual(["cats", "kittens"]);
      expect(hits[0]).toMatchObject({
        fileId: row.id,
        filename: `doc-${size}.txt`,
        score: 1,
      });
      expect(hits[1]?.score).toBeGreaterThan(0.8);
      expect(hits[1]?.score).toBeLessThan(1);

      expect(
        await searchChunks(db, {
          embedding: axis(size, 1),
          fileIds: [row.id],
          limit: 5,
          model: "other:model",
        })
      ).toEqual([]);
      expect(
        await searchChunks(db, {
          embedding: axis(size, 1),
          fileIds: [],
          limit: 5,
          model: "test:embed",
        })
      ).toEqual([]);
    }
  });
});

describe("access and listing", () => {
  const viewerOf = (userId: Viewer["userId"]): Viewer => ({
    principals: [{ id: userId, type: "user" }],
    userId,
  });

  const setup = async () => {
    const { db } = testDb;
    const owner = await seedUser(db);
    const friend = await seedUser(db);
    const stranger = await seedUser(db);
    const personal = await seedOrg(db, owner.id, { isPersonal: true });
    const chat = await createConversation(db, {
      context: { id: personal.id, type: "personal" },
      ownerId: owner.id,
    });
    const add = (name: string, conversationId: typeof chat.id | null = null) =>
      createFile(db, {
        conversationId,
        mediaType: "text/plain",
        name,
        ownerId: owner.id,
        purpose: "attachment",
        size: 1,
        storageDriver: "local",
        storageKey: `uploads/${newId("x")}`,
      });
    const attached = await add("attached.txt", chat.id);
    const loose = await add("loose.txt");
    return { attached, chat, db, friend, loose, owner, stranger };
  };

  test("owners read their files; chat readers read its attachments", async () => {
    const { attached, chat, db, friend, loose, owner } = await setup();
    expect((await getReadableFile(db, viewerOf(owner.id), loose.id)).ok).toBe(
      true
    );
    expect(
      await getReadableFile(db, viewerOf(friend.id), attached.id)
    ).toMatchObject({ error: { type: "not_found" } });
    await upsertGrant(db, {
      grantedBy: owner.id,
      permission: "viewer",
      principal: { id: friend.id, type: "user" },
      resource: { resourceId: chat.id, resourceType: "conversation" },
    });
    expect(
      (await getReadableFile(db, viewerOf(friend.id), attached.id)).ok
    ).toBe(true);
    // A grant on the chat reaches its attachments, not the owner's other files.
    expect(
      await getReadableFile(db, viewerOf(friend.id), loose.id)
    ).toMatchObject({ error: { type: "not_found" } });

    const page = expectOk(
      await listFiles(db, viewerOf(friend.id), {
        conversationId: chat.id,
        limit: 10,
      })
    );
    expect(page.items.map((row) => row.id)).toEqual([attached.id]);
  });

  test("pages the viewer's own files newest first", async () => {
    const { attached, db, loose, owner } = await setup();
    const first = expectOk(
      await listFiles(db, viewerOf(owner.id), { limit: 1 })
    );
    expect(first.items.map((row) => row.id)).toEqual([loose.id]);
    const second = expectOk(
      await listFiles(db, viewerOf(owner.id), {
        cursor: first.nextCursor ?? undefined,
        limit: 1,
      })
    );
    expect(second.items.map((row) => row.id)).toEqual([attached.id]);
    expect(second.nextCursor).toBeNull();
    expect(
      await listFiles(db, viewerOf(owner.id), { cursor: "junk", limit: 1 })
    ).toMatchObject({ error: { type: "invalid_cursor" } });
  });

  test("lists only indexed readable files for search", async () => {
    const { attached, chat, db, loose, owner, stranger } = await setup();
    expectOk(
      await replaceChunks(
        db,
        attached.id,
        [{ embedding: axis(5, 1), text: "x" }],
        "test:embed"
      )
    );
    expectOk(
      await replaceChunks(db, loose.id, [{ embedding: null, text: "y" }], null)
    );
    const owned = viewerOf(owner.id);
    expect(await listReadableIndexedFileIds(db, owned, { limit: 10 })).toEqual([
      attached.id,
    ]);
    expect(
      await listReadableIndexedFileIds(db, owned, {
        conversationId: chat.id,
        limit: 10,
      })
    ).toEqual([attached.id]);
    expect(
      await listReadableIndexedFileIds(db, owned, { fileIds: [], limit: 10 })
    ).toEqual([]);
    expect(
      await listReadableIndexedFileIds(db, viewerOf(stranger.id), {
        limit: 10,
      })
    ).toEqual([]);
  });

  test("walks files to re-index by id, and deletes with chunks", async () => {
    const { attached, db, loose } = await setup();
    for (const row of [attached, loose]) {
      // biome-ignore lint/performance/noAwaitInLoops: two files, in turn.
      const replaced = await replaceChunks(
        db,
        row.id,
        [{ embedding: axis(5, 1), text: "x" }],
        "test:old"
      );
      expectOk(replaced);
    }
    const ids = [attached.id, loose.id].sort();
    const all: string[] = [];
    let after: (typeof ids)[number] | null = null;
    for (;;) {
      // biome-ignore lint/performance/noAwaitInLoops: keyset pages in turn.
      const page: typeof ids = await listFileIdsToReindex(db, "test:new", {
        after,
        limit: 1,
      });
      if (page.length === 0) {
        break;
      }
      all.push(...page);
      after = page.at(-1) ?? null;
    }
    expect(
      all.filter((id) => ids.includes(id as (typeof ids)[number]))
    ).toEqual(ids);

    expect(expectOk(await deleteFile(db, loose.id)).id).toBe(loose.id);
    expect(await listChunks(db, loose.id)).toEqual([]);
    expect(await deleteFile(db, loose.id)).toMatchObject({
      error: { type: "not_found" },
    });
  });
});
