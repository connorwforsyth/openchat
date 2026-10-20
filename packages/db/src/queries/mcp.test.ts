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
import { createMcpServer } from "./library";
import { deleteUnversionedItem } from "./library-items";
import {
  deleteMcpOauthToken,
  getMcpOauthToken,
  getMcpServer,
  listConnectorPrefs,
  listConversationConnectors,
  listMcpOauthTokensToReseal,
  resetConversationConnectors,
  setConnectorPref,
  setConnectorToolPref,
  setConversationConnector,
  setConversationConnectorTool,
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

  test("stores connector choices per user, for servers with or without a row", async () => {
    const { db } = testDb;
    const user = await seedUser(db);
    const other = await seedUser(db);
    // An instance server's id: no mcp_server row behind it.
    const instance = newId("libraryItem");
    const server = await createMcpServer(db, {
      createdBy: user.id,
      definition: {
        auth: { scopes: [], type: "oauth" },
        kind: "mcp_server",
        transport: "http",
        url: "https://mcp.example.test/mcp",
      },
      name: "Notes",
      owner: { id: user.id, type: "user" },
    });

    expect((await listConnectorPrefs(db, user.id)).size).toBe(0);
    await setConnectorPref(db, {
      enabled: false,
      mcpServerId: instance,
      userId: user.id,
    });
    await setConnectorPref(db, {
      enabled: true,
      mcpServerId: instance,
      userId: user.id,
    });
    await setConnectorPref(db, {
      enabled: false,
      mcpServerId: server.id,
      userId: user.id,
    });
    expect(await listConnectorPrefs(db, user.id)).toEqual(
      new Map([
        [instance, { enabled: true, tools: {} }],
        [server.id, { enabled: false, tools: {} }],
      ])
    );
    expect((await listConnectorPrefs(db, other.id)).size).toBe(0);

    // OAuth tokens for an instance server have no row to point at either.
    await upsertMcpOauthToken(db, {
      ciphertext: "sealed",
      expiresAt: null,
      keyId: "k1",
      mcpServerId: instance,
      userId: user.id,
    });
    await upsertMcpOauthToken(db, {
      ciphertext: "sealed",
      expiresAt: null,
      keyId: "k1",
      mcpServerId: server.id,
      userId: user.id,
    });
    expect(await getMcpOauthToken(db, instance, user.id)).toBeDefined();

    // Deleting a library server takes its tokens and choices with it.
    expectOk(await deleteUnversionedItem(db, "mcp_server", server.id));
    expect(await getMcpOauthToken(db, server.id, user.id)).toBeUndefined();
    expect(await listConnectorPrefs(db, user.id)).toEqual(
      new Map([[instance, { enabled: true, tools: {} }]])
    );
  });

  test("merges tool switches into a user's defaults without touching the server's", async () => {
    const { db } = testDb;
    const user = await seedUser(db);
    const instance = newId("libraryItem");
    const base = { mcpServerId: instance, userId: user.id };

    await setConnectorToolPref(db, { ...base, enabled: false, tool: "a" });
    expect(await listConnectorPrefs(db, user.id)).toEqual(
      new Map([[instance, { enabled: null, tools: { a: false } }]])
    );
    await setConnectorPref(db, { ...base, enabled: true });
    await setConnectorToolPref(db, { ...base, enabled: false, tool: "b" });
    await setConnectorToolPref(db, { ...base, enabled: true, tool: "a" });
    expect(await listConnectorPrefs(db, user.id)).toEqual(
      new Map([[instance, { enabled: true, tools: { a: true, b: false } }]])
    );
  });

  test("keeps a chat's choices per user until they're reset", async () => {
    const { db } = testDb;
    const user = await seedUser(db);
    const other = await seedUser(db);
    const personal = await seedOrg(db, user.id, { isPersonal: true });
    const chat = await createConversation(db, {
      context: { id: personal.id, type: "personal" },
      ownerId: user.id,
    });
    const instance = newId("libraryItem");
    const scope = { conversationId: chat.id, userId: user.id };

    await setConversationConnectorTool(db, {
      ...scope,
      enabled: false,
      mcpServerId: instance,
      tool: "search",
    });
    await setConversationConnector(db, {
      ...scope,
      enabled: false,
      mcpServerId: instance,
    });
    expect(await listConversationConnectors(db, scope)).toEqual(
      new Map([[instance, { enabled: false, tools: { search: false } }]])
    );
    expect(
      (
        await listConversationConnectors(db, {
          conversationId: chat.id,
          userId: other.id,
        })
      ).size
    ).toBe(0);
    // A chat's choices never leak into the user's defaults.
    expect((await listConnectorPrefs(db, user.id)).size).toBe(0);

    await resetConversationConnectors(db, scope);
    expect((await listConversationConnectors(db, scope)).size).toBe(0);
  });
});
