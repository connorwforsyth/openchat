import { call } from "@orpc/server";
import { appConfigSchema } from "@workspace/config/schema";
import type { UserId } from "@workspace/contract/schemas/common";
import { createConversation } from "@workspace/db/queries/conversations";
import {
  createTestDb,
  seedOrg,
  seedUser,
  type TestDb,
} from "@workspace/db/testing";
import { instanceServerId } from "@workspace/mcp/server-config";
import { newId } from "@workspace/shared/ids";
import { ok } from "@workspace/shared/result";
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
        tools: { required: ["log_event"] },
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

const listed = [
  { description: "Search the docs", inputSchema: {}, name: "search" },
  { description: null, inputSchema: {}, name: "fetch_page" },
  { description: null, inputSchema: {}, name: "log_event" },
];

const router = () =>
  createConnectorsRouter({
    catalog: mcp.servers,
    db: t.db,
    // A fake connection: the operator's deny list is the manager's job.
    listTools: () => Promise.resolve(ok(listed)),
    userServers: mcp.userServers,
  }).connectors;

const chatOf = async (userId: UserId) => {
  const personal = await seedOrg(t.db, userId, { isPersonal: true });
  return createConversation(t.db, {
    context: { id: personal.id, type: "personal" },
    ownerId: userId,
  });
};

describe("connectors procedures", () => {
  it("needs a session", async () => {
    await expect(call(router().list, {}, as(null))).rejects.toThrow();
  });

  it("lists the catalog with the user policy, and saves a toggle", async () => {
    const user = await seedUser(t.db);
    const list = await call(router().list, {}, as(user.id));
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
    const again = await call(router().list, {}, as(user.id));
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

  it("lists a connector's tools and saves a tool switch in the defaults", async () => {
    const user = await seedUser(t.db);
    const id = instanceServerId("docs");
    const tools = await call(router().tools, { id }, as(user.id));
    expect(tools.reachable).toBe(true);
    expect(tools.tools.map((tool) => [tool.name, tool.enabled])).toEqual([
      ["search", true],
      ["fetch_page", true],
      ["log_event", true],
    ]);

    await call(
      router().setToolEnabled,
      { enabled: false, id, tool: "fetch_page" },
      as(user.id)
    );
    const after = await call(router().tools, { id }, as(user.id));
    expect(after.tools.find((tool) => tool.name === "fetch_page")).toEqual({
      description: null,
      enabled: false,
      lock: null,
      name: "fetch_page",
    });
    const list = await call(router().list, {}, as(user.id));
    expect(list.connectors[0]?.disabledTools).toEqual(["fetch_page"]);
  });

  it("locks the operator's required tools", async () => {
    const user = await seedUser(t.db);
    const id = instanceServerId("audit");
    const tools = await call(router().tools, { id }, as(user.id));
    expect(tools.tools.find((tool) => tool.name === "log_event")?.lock).toEqual(
      { reason: null, type: "required" }
    );
    await expect(
      call(
        router().setToolEnabled,
        { enabled: false, id, tool: "log_event" },
        as(user.id)
      )
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("keeps a chat's choices to that chat until it's reset", async () => {
    const user = await seedUser(t.db);
    const chat = await chatOf(user.id);
    const id = instanceServerId("docs");
    const here = { conversationId: chat.id };

    await call(
      router().setEnabled,
      { ...here, enabled: false, id },
      as(user.id)
    );
    await call(
      router().setToolEnabled,
      { ...here, enabled: false, id, tool: "search" },
      as(user.id)
    );
    const inChat = await call(router().list, here, as(user.id));
    expect(inChat.customized).toBe(true);
    expect(inChat.connectors[0]).toMatchObject({
      customized: true,
      disabledTools: ["search"],
      enabled: false,
    });
    const tools = await call(router().tools, { ...here, id }, as(user.id));
    expect(tools.tools[0]).toMatchObject({ enabled: false, name: "search" });

    // The defaults, and other chats, didn't move.
    const defaults = await call(router().list, {}, as(user.id));
    expect(defaults.customized).toBe(false);
    expect(defaults.connectors[0]).toMatchObject({
      disabledTools: [],
      enabled: true,
    });

    await call(router().resetConversation, here, as(user.id));
    const reset = await call(router().list, here, as(user.id));
    expect(reset.customized).toBe(false);
    expect(reset.connectors[0]?.enabled).toBe(true);
  });

  it("answers NOT_FOUND for a chat the caller can't see", async () => {
    const owner = await seedUser(t.db);
    const stranger = await seedUser(t.db);
    const chat = await chatOf(owner.id);
    const id = instanceServerId("docs");
    await expect(
      call(
        router().setEnabled,
        { conversationId: chat.id, enabled: false, id },
        as(stranger.id)
      )
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      call(
        router().resetConversation,
        { conversationId: newId("conversation") },
        as(owner.id)
      )
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
