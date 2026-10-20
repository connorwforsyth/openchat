import { call } from "@orpc/server";
import { appConfigSchema } from "@workspace/config/schema";
import type { UserId } from "@workspace/contract/schemas/common";
import { createTestDb, seedUser, type TestDb } from "@workspace/db/testing";
import { instanceServerId } from "@workspace/mcp/server-config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createConnectorsRouter } from "./connectors";

// The `connectors` procedures in-process over PGlite (184). No MCP server is
// contacted: listing and toggling never connect.

let t: TestDb;
beforeAll(async () => {
  t = await createTestDb();
});
afterAll(() => t.close());

const { mcp } = appConfigSchema.parse({
  mcp: {
    servers: [
      { name: "docs", url: "https://docs.example.test/mcp" },
      {
        default: "required",
        name: "audit",
        reason: "Required by IT",
        url: "https://audit.example.test/mcp",
      },
    ],
    userServers: { allowed: false },
  },
});

const as = (userId: UserId | null) => ({
  context: {
    request: new Request("http://x"),
    session: userId ? { userId } : null,
  },
});

const router = () =>
  createConnectorsRouter({
    catalog: mcp.servers,
    db: t.db,
    userServers: mcp.userServers,
  }).connectors;

describe("connectors procedures", () => {
  it("needs a session", async () => {
    await expect(call(router().list, undefined, as(null))).rejects.toThrow();
  });

  it("lists the catalog with the user policy, and saves a toggle", async () => {
    const user = await seedUser(t.db);
    const list = await call(router().list, undefined, as(user.id));
    expect(list.userServers).toEqual({
      allowed: false,
      hosts: [],
      transports: ["http", "sse"],
    });
    expect(list.connectors.map((c) => [c.name, c.enabled, c.lock])).toEqual([
      ["docs", true, null],
      ["audit", true, { reason: "Required by IT", type: "required" }],
    ]);

    const off = await call(
      router().setEnabled,
      { enabled: false, id: instanceServerId("docs") },
      as(user.id)
    );
    expect(off.enabled).toBe(false);
    const again = await call(router().list, undefined, as(user.id));
    expect(again.connectors[0]?.enabled).toBe(false);
  });

  it("answers FORBIDDEN for a locked connector and NOT_FOUND for an unknown one", async () => {
    const user = await seedUser(t.db);
    await expect(
      call(
        router().setEnabled,
        { enabled: false, id: instanceServerId("audit") },
        as(user.id)
      )
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      call(
        router().setEnabled,
        { enabled: false, id: instanceServerId("nope") },
        as(user.id)
      )
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
