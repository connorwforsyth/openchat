import { fileSchema } from "@workspace/contract/schemas/files";
import { newId } from "@workspace/shared/ids";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { createTestDb, expectOk, seedUser, type TestDb } from "../testing";
import {
  createFile,
  getFile,
  listChunks,
  listFilesToReindex,
  replaceChunks,
  searchChunks,
  setFileState,
  toFileRecord,
} from "./files";

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
