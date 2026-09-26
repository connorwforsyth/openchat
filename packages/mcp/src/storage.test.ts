import { randomBytes } from "node:crypto";

import type { LibraryItemId, UserId } from "@workspace/contract/schemas/common";
import { upsertGrant } from "@workspace/db/queries/grants";
import { createMcpServer } from "@workspace/db/queries/library";
import {
  getMcpOauthToken,
  upsertMcpOauthToken,
} from "@workspace/db/queries/mcp";
import {
  createTestDb,
  expectOk,
  seedOrg,
  seedUser,
  type TestDb,
} from "@workspace/db/testing";
import { err } from "@workspace/shared/result";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { createMcp } from "./create";
import { keyRingOf, loadKeyRing } from "./crypto";
import { handleOAuthCallback, mcpHandlers } from "./handlers";
import type { McpManager } from "./manager";
import type { StoredOAuth } from "./oauth";
import { instanceServerId } from "./server-config";
import { type McpFixture, startMcpFixture } from "./testing/fixture-server";
import { createDbTokenStore } from "./token-store";

// Token storage on a real schema (PGlite) and the `mcp` handlers end to end.

let testDb: TestDb;
let fixture: McpFixture;
let plain: McpFixture;
beforeAll(async () => {
  [testDb, fixture, plain] = await Promise.all([
    createTestDb(),
    startMcpFixture({ oauth: true }),
    startMcpFixture(),
  ]);
});
afterAll(async () => {
  await Promise.all([testDb.close(), fixture.close(), plain.close()]);
});

const stored: StoredOAuth = {
  client: { client_id: "client-1" },
  dynamicClient: true,
  obtainedAt: Date.parse("2030-01-01T00:00:00Z"),
  tokens: {
    access_token: "access-plain-value",
    expires_in: 3600,
    refresh_token: "refresh-plain-value",
    token_type: "Bearer",
  },
};

const seedServer = async (ownerId: UserId, url = fixture.url) =>
  createMcpServer(testDb.db, {
    createdBy: ownerId,
    definition: {
      auth: { scopes: [], type: "oauth" },
      kind: "mcp_server",
      transport: "http",
      url,
    },
    name: "Tracker",
    owner: { id: ownerId, type: "user" },
  });

describe("database token store", () => {
  it("seals tokens at rest and binds them to their row", async () => {
    const { db } = testDb;
    const [alice, bob] = await Promise.all([seedUser(db), seedUser(db)]);
    const server = await seedServer(alice.id);
    const store = createDbTokenStore(
      db,
      loadKeyRing({
        ENCRYPTION_KEY: randomBytes(32).toString("base64"),
      })
    );

    expectOk(await store.save(server.id, alice.id, stored));
    const row = await getMcpOauthToken(db, server.id, alice.id);
    expect(row?.ciphertext).not.toContain("access-plain-value");
    expect(row?.ciphertext).not.toContain("refresh-plain-value");
    expect(row?.expiresAt?.toISOString()).toBe("2030-01-01T01:00:00.000Z");
    expect(expectOk(await store.load(server.id, alice.id))).toEqual(stored);

    // Copied into Bob's row, Alice's ciphertext doesn't open.
    if (!row) {
      throw new Error("no row");
    }
    await upsertMcpOauthToken(db, { ...row, userId: bob.id });
    expect(expectOk(await store.load(server.id, bob.id))).toBeUndefined();

    await store.remove(server.id, alice.id);
    expect(expectOk(await store.load(server.id, alice.id))).toBeUndefined();
  });

  it("reseals under the new key after rotation", async () => {
    const { db } = testDb;
    const alice = await seedUser(db);
    const server = await seedServer(alice.id);
    const oldKey = randomBytes(32);
    const newKey = randomBytes(32);
    const before = createDbTokenStore(db, {
      ok: true,
      value: keyRingOf(oldKey),
    });
    expectOk(await before.save(server.id, alice.id, stored));

    const rotated = loadKeyRing({
      ENCRYPTION_KEY: newKey.toString("base64"),
      ENCRYPTION_KEY_PREVIOUS: oldKey.toString("base64"),
    });
    const after = createDbTokenStore(db, rotated);
    expect(expectOk(await after.load(server.id, alice.id))).toEqual(stored);
    const row = await getMcpOauthToken(db, server.id, alice.id);
    expect(row?.keyId).toBe(keyRingOf(newKey).current.id);
  });

  it("degrades without a key instead of throwing", async () => {
    const { db } = testDb;
    const alice = await seedUser(db);
    const server = await seedServer(alice.id);
    const store = createDbTokenStore(
      db,
      loadKeyRing({ NODE_ENV: "production" })
    );
    expect(await store.load(server.id, alice.id)).toMatchObject({
      error: { type: "secrets_unavailable" },
    });
    expect(await store.save(server.id, alice.id, stored)).toMatchObject({
      error: { type: "secrets_unavailable" },
    });
  });
});

describe("mcp handlers", () => {
  let manager: McpManager;
  afterEach(() => manager.close());

  const build = () => {
    ({ manager } = createMcp({
      allowPrivateNetworks: true,
      config: {
        brand: { name: "Test" } as never,
        mcp: {
          servers: [
            { headers: {}, name: "open", transport: "http", url: plain.url },
          ],
        },
      },
      db: testDb.db,
      env: { ENCRYPTION_KEY: randomBytes(32).toString("base64") },
      oauthRedirectUrl: "http://app.example.test/api/mcp/oauth/callback",
    }));
    return manager;
  };

  const deps = (userId: UserId) => ({
    db: testDb.db,
    manager,
    session: { userId },
  });

  it("checks access: owner, org member, grantee; others see nothing", async () => {
    const { db } = testDb;
    const [owner, member, grantee, stranger] = await Promise.all([
      seedUser(db),
      seedUser(db),
      seedUser(db),
      seedUser(db),
    ]);
    build();
    const org = await seedOrg(db, member.id);
    const personal = await seedServer(owner.id);
    const orgServer = await createMcpServer(db, {
      createdBy: owner.id,
      definition: {
        auth: { type: "none" },
        kind: "mcp_server",
        transport: "http",
        url: fixture.url,
      },
      name: "Org tracker",
      owner: { id: org.id, type: "org" },
    });
    expectOk(
      await upsertGrant(db, {
        grantedBy: owner.id,
        permission: "use",
        principal: { id: grantee.id, type: "user" },
        resource: { resourceId: personal.id, resourceType: "mcp_server" },
      })
    );

    const status = (userId: UserId, id: LibraryItemId) =>
      mcpHandlers.status(deps(userId), { id });
    expect(await status(owner.id, personal.id)).toEqual({
      ok: true,
      value: { state: "needs_auth" },
    });
    expect((await status(grantee.id, personal.id)).ok).toBe(true);
    expect(await status(stranger.id, personal.id)).toEqual(
      err({ code: "NOT_FOUND" })
    );
    expect(await status(member.id, orgServer.id)).toMatchObject({ ok: true });
    expect(await status(stranger.id, orgServer.id)).toEqual(
      err({ code: "NOT_FOUND" })
    );
    // A stdio server is the owner's to see (disabled here), nobody else's.
    const stdio = await createMcpServer(db, {
      createdBy: owner.id,
      definition: {
        command: "npx",
        kind: "mcp_server",
        transport: "stdio",
      } as never,
      name: "Local",
      owner: { id: owner.id, type: "user" },
    });
    expect(await status(owner.id, stdio.id)).toEqual({
      ok: true,
      value: { state: "disabled" },
    });
    expect(await status(stranger.id, stdio.id)).toEqual(
      err({ code: "NOT_FOUND" })
    );
    // An OAuth server needs sign-in to be reached, so no tools yet.
    expect(
      await mcpHandlers.tools(deps(owner.id), { id: personal.id })
    ).toEqual({ ok: true, value: [] });
    // Instance servers are everyone's; no OAuth there.
    expect(
      await mcpHandlers.startOAuth(deps(stranger.id), {
        id: instanceServerId("open"),
      })
    ).toMatchObject({ error: { code: "VALIDATION" } });
  });

  it("signs in through the handlers and the callback, tokens sealed in the database", async () => {
    const { db } = testDb;
    const [alice, bob] = await Promise.all([seedUser(db), seedUser(db)]);
    build();
    const server = await seedServer(alice.id);

    const started = await mcpHandlers.startOAuth(deps(alice.id), {
      id: server.id,
    });
    if (!started.ok) {
      throw new Error(JSON.stringify(started.error));
    }
    const query = fixture.approve(started.value.authorizationUrl, "alice");

    // Delivered to the wrong session: refused, nothing stored.
    expect(
      await handleOAuthCallback({ manager, session: { userId: bob.id } }, query)
    ).toMatchObject({ ok: false });
    expect(await getMcpOauthToken(db, server.id, bob.id)).toBeUndefined();

    const restarted = await mcpHandlers.startOAuth(deps(alice.id), {
      id: server.id,
    });
    const again = fixture.approve(
      restarted.ok ? restarted.value.authorizationUrl : "",
      "alice"
    );
    expect(
      await handleOAuthCallback(
        { manager, session: { userId: alice.id } },
        again
      )
    ).toEqual({ ok: true, serverId: server.id });
    const row = await getMcpOauthToken(db, server.id, alice.id);
    expect(row?.ciphertext.startsWith("v1.")).toBe(true);

    expect(await mcpHandlers.status(deps(alice.id), { id: server.id })).toEqual(
      { ok: true, value: { state: "connected", toolCount: 3 } }
    );
    const tools = await mcpHandlers.tools(deps(alice.id), { id: server.id });
    expect(tools.ok && tools.value.map((tool) => tool.name).sort()).toEqual([
      "add",
      "echo",
      "whoami",
    ]);

    expect(
      await mcpHandlers.disconnect(deps(alice.id), { id: server.id })
    ).toEqual({ ok: true, value: undefined });
    expect(await getMcpOauthToken(db, server.id, alice.id)).toBeUndefined();
    expect(await mcpHandlers.status(deps(alice.id), { id: server.id })).toEqual(
      { ok: true, value: { state: "needs_auth" } }
    );
  });

  it("boots with no database and no key: instance servers still work", async () => {
    ({ manager } = createMcp({
      allowPrivateNetworks: true,
      config: {
        brand: { name: "Test" } as never,
        mcp: {
          servers: [
            { headers: {}, name: "open", transport: "http", url: plain.url },
          ],
        },
      },
      env: {},
    }));
    const alice = (await seedUser(testDb.db)).id;
    expect(
      await mcpHandlers.status(
        { manager, session: { userId: alice } },
        { id: instanceServerId("open") }
      )
    ).toEqual({ ok: true, value: { state: "connected", toolCount: 3 } });
  });
});
