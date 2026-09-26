import { newId } from "@workspace/shared/ids";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { createTestDb, expectOk, seedUser, type TestDb } from "../testing";
import { createMcpServer } from "./library";
import {
  deleteMcpOauthToken,
  getMcpOauthToken,
  getMcpServer,
  listMcpOauthTokensToReseal,
  upsertMcpOauthToken,
} from "./mcp";

let testDb: TestDb;
beforeAll(async () => {
  testDb = await createTestDb();
});
afterAll(() => testDb.close());

describe("mcp queries", () => {
  test("reads a saved server and keeps one token row per user and server", async () => {
    const { db } = testDb;
    const user = await seedUser(db);
    const server = await createMcpServer(db, {
      createdBy: user.id,
      definition: {
        auth: { scopes: [], type: "oauth" },
        kind: "mcp_server",
        transport: "http",
        url: "https://mcp.example.test/mcp",
      },
      name: "Docs",
      owner: { id: user.id, type: "user" },
    });

    expect(expectOk(await getMcpServer(db, server.id)).name).toBe("Docs");
    const missing = await getMcpServer(db, newId("libraryItem"));
    expect(missing.ok).toBe(false);

    expect(await getMcpOauthToken(db, server.id, user.id)).toBeUndefined();
    const base = { mcpServerId: server.id, userId: user.id };
    await upsertMcpOauthToken(db, {
      ...base,
      ciphertext: "sealed-1",
      expiresAt: null,
      keyId: "old",
    });
    await upsertMcpOauthToken(db, {
      ...base,
      ciphertext: "sealed-2",
      expiresAt: new Date("2030-01-01T00:00:00Z"),
      keyId: "new",
    });
    const row = await getMcpOauthToken(db, server.id, user.id);
    expect(row).toMatchObject({ ciphertext: "sealed-2", keyId: "new" });
    expect(row?.expiresAt?.toISOString()).toBe("2030-01-01T00:00:00.000Z");

    expect(await listMcpOauthTokensToReseal(db, "new")).toEqual([]);
    expect(await listMcpOauthTokensToReseal(db, "newer")).toHaveLength(1);

    expect(await deleteMcpOauthToken(db, server.id, user.id)).toBe(true);
    expect(await deleteMcpOauthToken(db, server.id, user.id)).toBe(false);
  });
});
