import { appConfigSchema } from "@workspace/config/schema";
import type { UserId } from "@workspace/contract/schemas/common";
import { upsertGrant } from "@workspace/db/queries/grants";
import { createMcpServer } from "@workspace/db/queries/library";
import {
  createTestDb,
  expectOk,
  seedUser,
  type TestDb,
} from "@workspace/db/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { instanceServerId } from "./server-config";
import {
  connectorHandlers,
  disabledServersFor,
  enabledServersFor,
  type McpDeps,
} from "./service";

let testDb: TestDb;
beforeAll(async () => {
  testDb = await createTestDb();
});
afterAll(() => testDb.close());

const mcp = appConfigSchema.shape.mcp.parse({
  servers: [
    { name: "docs", url: "https://docs.example.test/mcp" },
    {
      default: "required",
      name: "audit",
      reason: "Required by IT",
      url: "https://audit.example.test/mcp",
    },
    { command: "npx", default: "off", name: "files", transport: "stdio" },
  ],
});

const depsOf = (withDb: boolean): McpDeps => ({
  catalog: mcp.servers,
  db: withDb ? testDb.db : undefined,
  userServers: mcp.userServers,
});

const saveServer = (userId: UserId, name: string) =>
  createMcpServer(testDb.db, {
    createdBy: userId,
    definition: {
      auth: { scopes: [], type: "oauth" },
      kind: "mcp_server",
      transport: "http",
      url: "https://notes.example.test/mcp",
    },
    name,
    owner: { id: userId, type: "user" },
  });

describe("connector service", () => {
  it("lists the catalog alone without a database, and can't save a choice", async () => {
    const user = await seedUser(testDb.db);
    const list = await connectorHandlers.list(depsOf(false), {
      userId: user.id,
    });
    expect(list.connectors.map((c) => [c.name, c.enabled])).toEqual([
      ["docs", true],
      ["audit", true],
      ["files", false],
    ]);
    expect(list.userServers.allowed).toBe(true);
    const saved = await connectorHandlers.setEnabled(
      depsOf(false),
      { userId: user.id },
      { enabled: false, id: instanceServerId("docs") }
    );
    expect(saved.ok).toBe(false);
  });

  it("merges owned and shared library servers and applies the user's choices", async () => {
    const alice = await seedUser(testDb.db);
    const bob = await seedUser(testDb.db);
    const own = await saveServer(alice.id, "alice-notes");
    const shared = await saveServer(bob.id, "bob-wiki");
    expectOk(
      await upsertGrant(testDb.db, {
        grantedBy: bob.id,
        permission: "use",
        principal: { id: alice.id, type: "user" },
        resource: { resourceId: shared.id, resourceType: "mcp_server" },
      })
    );
    const deps = depsOf(true);
    const session = { userId: alice.id };

    const turnedOff = expectOk(
      await connectorHandlers.setEnabled(deps, session, {
        enabled: false,
        id: instanceServerId("docs"),
      })
    );
    expect(turnedOff.enabled).toBe(false);
    expectOk(
      await connectorHandlers.setEnabled(deps, session, {
        enabled: false,
        id: own.id,
      })
    );

    const list = await connectorHandlers.list(deps, session);
    expect(list.connectors.map((c) => [c.name, c.source, c.enabled])).toEqual([
      ["docs", "instance", false],
      ["audit", "instance", true],
      ["files", "instance", false],
      ["alice-notes", "library", false],
      ["bob-wiki", "library", true],
    ]);
    expect(await enabledServersFor(deps, alice.id)).toEqual([
      instanceServerId("audit"),
      shared.id,
    ]);
    expect(await disabledServersFor(deps, alice.id)).toEqual(
      new Set([instanceServerId("docs"), instanceServerId("files"), own.id])
    );
    // Bob's view is his own.
    expect(await enabledServersFor(deps, bob.id)).toEqual([
      instanceServerId("docs"),
      instanceServerId("audit"),
      shared.id,
    ]);
  });

  it("refuses to turn off a required connector and hides servers the user can't use", async () => {
    const alice = await seedUser(testDb.db);
    const bob = await seedUser(testDb.db);
    const bobs = await saveServer(bob.id, "private");
    const deps = depsOf(true);
    const session = { userId: alice.id };
    const required = await connectorHandlers.setEnabled(deps, session, {
      enabled: false,
      id: instanceServerId("audit"),
    });
    expect(required).toEqual({ error: { code: "FORBIDDEN" }, ok: false });
    const hidden = await connectorHandlers.setEnabled(deps, session, {
      enabled: false,
      id: bobs.id,
    });
    expect(hidden).toEqual({ error: { code: "NOT_FOUND" }, ok: false });
  });
});
