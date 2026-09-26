import { memoryVersionSchema } from "@workspace/contract/schemas/memory";
import { newId } from "@workspace/shared/ids";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { createTestDb, expectOk, seedUser, type TestDb } from "../testing";
import {
  getMemory,
  listMemoryVersions,
  revertMemory,
  setMemoryMode,
  toMemoryVersion,
  writeMemory,
} from "./memory";

let testDb: TestDb;
beforeAll(async () => {
  testDb = await createTestDb();
});
afterAll(() => testDb.close());

describe("memory", () => {
  test("versions every write, guards stale edits, and undoes by reverting", async () => {
    const { db } = testDb;
    const user = await seedUser(db);
    expect(await getMemory(db, user.id)).toMatchObject({
      content: "",
      currentVersionId: null,
      mode: "auto",
    });

    const v1 = expectOk(
      await writeMemory(db, {
        baseVersionId: null,
        content: "Prefers pnpm.",
        source: { type: "user" },
        userId: user.id,
      })
    );
    expect(v1.number).toBe(1);

    const v2 = expectOk(
      await writeMemory(db, {
        content: "Prefers pnpm.\nWrites Swift.",
        source: {
          conversationId: newId("conversation"),
          messageId: newId("message"),
          runId: newId("run"),
          type: "agent",
        },
        userId: user.id,
      })
    );
    expect(v2.number).toBe(2);

    expect(
      await writeMemory(db, {
        baseVersionId: v1.id,
        content: "stale edit",
        source: { type: "user" },
        userId: user.id,
      })
    ).toMatchObject({
      error: { reason: "version_mismatch", type: "conflict" },
    });

    const undone = expectOk(await revertMemory(db, user.id, v1.id));
    expect(undone).toMatchObject({
      content: "Prefers pnpm.",
      number: 3,
      source: { fromVersionId: v1.id, type: "revert" },
    });
    expect(await getMemory(db, user.id)).toMatchObject({
      content: "Prefers pnpm.",
      currentVersionId: undone.id,
    });

    const versions = await listMemoryVersions(db, user.id);
    expect(versions.map((v) => v.number)).toEqual([3, 2, 1]);
    expect(
      (await listMemoryVersions(db, user.id, { before: 3, limit: 1 })).map(
        (v) => v.number
      )
    ).toEqual([2]);
    const mapped = toMemoryVersion(v2);
    expect(memoryVersionSchema.parse(mapped)).toEqual(mapped);

    const other = await seedUser(db);
    expect(await revertMemory(db, other.id, v1.id)).toMatchObject({
      error: { type: "not_found" },
    });
  });

  test("the mode is stored per user", async () => {
    const { db } = testDb;
    const user = await seedUser(db);
    expect((await setMemoryMode(db, user.id, "propose")).mode).toBe("propose");
    expect((await getMemory(db, user.id)).mode).toBe("propose");
  });
});
