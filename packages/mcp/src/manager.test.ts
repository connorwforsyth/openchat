import { randomBytes } from "node:crypto";

import { runAgent } from "@workspace/ai/agent/run-agent";
import {
  readAll,
  textStream,
  toolCallStream,
} from "@workspace/ai/testing/mock-models";
import { resolveTools } from "@workspace/ai/tools/resolve";
import { buildToolSet } from "@workspace/ai/tools/tool-set";
import type { LibraryItemId } from "@workspace/contract/schemas/common";
import { agentDefinitionSchema } from "@workspace/contract/schemas/library";
import { newId } from "@workspace/shared/ids";
import { err, ok } from "@workspace/shared/result";
import type { UIMessage } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { keyRingOf, MCP_HEADER_SECRET_AAD, seal } from "./crypto";
import { createMcpManager, type McpManagerOptions } from "./manager";
import {
  fromInstanceConfig,
  fromLibraryRow,
  type McpServerConfig,
} from "./server-config";
import { type McpFixture, startMcpFixture } from "./testing/fixture-server";

const alice = newId("user");
const bob = newId("user");

let fixture: McpFixture;
beforeAll(async () => {
  fixture = await startMcpFixture();
});
afterAll(() => fixture.close());

const instance = (url: string, name = "docs"): McpServerConfig =>
  fromInstanceConfig({ headers: {}, name, transport: "http", url });

const libraryServer = (
  definition: object,
  extra: object = {}
): McpServerConfig => {
  const result = fromLibraryRow({
    definition: { kind: "mcp_server", ...definition } as never,
    id: newId("libraryItem"),
    name: "Notes",
    ownerId: alice,
    ownerType: "user",
    secretCiphertext: null,
    secretKeyId: null,
    ...extra,
  });
  if (!result.ok) {
    throw new Error(result.error.type);
  }
  return result.value;
};

const managers: ReturnType<typeof createMcpManager>[] = [];
const managerFor = (
  servers: readonly McpServerConfig[],
  options: Partial<McpManagerOptions> = {}
) => {
  const byId = new Map(servers.map((server) => [server.id, server]));
  const manager = createMcpManager({
    allowPrivateNetworks: true,
    clientName: "test-client",
    resolveServer: (id) => {
      const server = byId.get(id);
      return Promise.resolve(
        server ? ok(server) : err({ serverId: id, type: "not_found" as const })
      );
    },
    sleep: () => Promise.resolve(),
    sweepIntervalMs: 0,
    ...options,
  });
  managers.push(manager);
  return manager;
};
afterEach(async () => {
  await Promise.all(managers.splice(0).map((manager) => manager.close()));
});

const agent = (servers: { id: LibraryItemId; tools?: string[] }[]) =>
  agentDefinitionSchema.parse({
    instructions: "",
    kind: "agent",
    mcpServers: servers,
    model: "fast",
  });

const planFor = (servers: { id: LibraryItemId; tools?: string[] }[]) =>
  resolveTools(
    agent(servers),
    { builtins: new Set(), modelSupportsTools: true },
    { mcpServers: new Set(servers.map((server) => server.id)) }
  );

describe("connection manager", () => {
  it("connects, lists tools and reports status", async () => {
    const docs = instance(fixture.url);
    const manager = managerFor([docs]);
    expect(await manager.status(docs.id, alice)).toEqual({
      state: "connected",
      toolCount: 3,
    });
    const tools = await manager.listTools(docs.id, alice);
    expect(tools.ok && tools.value.map((tool) => tool.name).sort()).toEqual([
      "add",
      "echo",
      "whoami",
    ]);
  });

  it("never hands the model a tool the user switched off (188)", async () => {
    const docs = instance(fixture.url);
    const manager = managerFor([docs]);
    const plan = resolveTools(
      agent([{ id: docs.id }]),
      { builtins: new Set(), modelSupportsTools: true },
      {
        mcpExcludedTools: new Map([[docs.id, ["echo"]]]),
        mcpServers: new Set([docs.id]),
      }
    );
    const built = await buildToolSet(plan, {
      builtins: {},
      mcp: manager.toolSource(alice),
    });
    expect(Object.keys(built.tools).sort()).toEqual([
      "docs__add",
      "docs__whoami",
    ]);
  });

  it("merges MCP tools into an agent's tool set and runs one", async () => {
    const docs = instance(fixture.url);
    const manager = managerFor([docs]);
    const built = await buildToolSet(
      planFor([{ id: docs.id, tools: ["echo", "add"] }]),
      { builtins: {}, mcp: manager.toolSource(alice) }
    );
    expect(Object.keys(built.tools).sort()).toEqual([
      "docs__add",
      "docs__echo",
    ]);

    let step = 0;
    const model = new MockLanguageModelV4({
      doStream: () => {
        step += 1;
        return Promise.resolve(
          step === 1
            ? toolCallStream("docs__echo", { text: "hello from mcp" })
            : textStream("done")
        );
      },
    });
    const message: UIMessage = {
      id: "u1",
      parts: [{ text: "echo it", type: "text" }],
      role: "user",
    };
    const run = await runAgent({
      messages: [message],
      model,
      toolApproval: built.toolApproval,
      tools: built.tools,
    });
    if (!run.ok) {
      throw new Error(run.error.message);
    }
    await readAll(run.value.stream);
    const outcome = await run.value.outcome;
    expect(outcome.status).toBe("succeeded");
    const toolPart = outcome.message.parts.find(
      (part) => "toolCallId" in part && part.toolCallId === "call-1"
    );
    expect(toolPart).toMatchObject({
      output: { content: [{ text: "hello from mcp", type: "text" }] },
      state: "output-available",
    });
    // The model saw the result on its second step.
    expect(JSON.stringify(model.doStreamCalls[1]?.prompt)).toContain(
      "hello from mcp"
    );
  });

  it("speaks legacy SSE too", async () => {
    const sse = fromInstanceConfig({
      headers: {},
      name: "legacy",
      transport: "sse",
      url: fixture.sseUrl,
    });
    const manager = managerFor([sse]);
    const tools = await manager.toolSource(alice).tools({ id: sse.id });
    if (!tools.ok) {
      throw new Error(tools.error.message);
    }
    const add = tools.value.legacy__add;
    const result = await add?.execute?.({ a: 2, b: 3 }, {
      messages: [],
      toolCallId: "c1",
    } as never);
    expect(result).toMatchObject({ content: [{ text: "5", type: "text" }] });
  });

  it("shares one connection across users for shared servers", async () => {
    const own = await startMcpFixture();
    try {
      const docs = instance(own.url);
      const manager = managerFor([docs]);
      await Promise.all([
        manager.status(docs.id, alice),
        manager.status(docs.id, bob),
        manager.toolSource(alice).tools({ id: docs.id }),
      ]);
      expect(own.stats.initializes).toBe(1);
      expect(manager.openConnections()).toBe(1);
    } finally {
      await own.close();
    }
  });

  it("isolates user-owned servers per user", async () => {
    const own = await startMcpFixture();
    try {
      const notes = libraryServer({
        auth: { type: "none" },
        transport: "http",
        url: own.url,
      });
      const manager = managerFor([notes]);
      await manager.status(notes.id, alice);
      await manager.status(notes.id, bob);
      expect(own.stats.initializes).toBe(2);
      expect(manager.openConnections()).toBe(2);
    } finally {
      await own.close();
    }
  });

  it("reconnects after the server restarts, without losing the call", async () => {
    const own = await startMcpFixture();
    try {
      const docs = instance(own.url);
      const manager = managerFor([docs]);
      const tools = await manager.toolSource(alice).tools({ id: docs.id });
      if (!tools.ok) {
        throw new Error(tools.error.message);
      }
      const echo = tools.value.docs__echo;
      const call = (text: string) =>
        echo?.execute?.({ text }, { messages: [], toolCallId: text } as never);

      expect(await call("before")).toMatchObject({
        content: [{ text: "before" }],
      });
      await own.restart();
      // Let the client see its old sockets close, as it would for any real
      // restart; then the old session is gone (404), so the manager
      // reconnects and resends the call the server never saw.
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(await call("after")).toMatchObject({
        content: [{ text: "after" }],
      });
      expect(own.stats.initializes).toBe(2);
      expect(await manager.status(docs.id, alice)).toMatchObject({
        state: "connected",
      });
    } finally {
      await own.close();
    }
  });

  it("resends a call the server never saw when its session expired", async () => {
    const own = await startMcpFixture();
    try {
      const docs = instance(own.url);
      const manager = managerFor([docs]);
      const tools = await manager.toolSource(alice).tools({ id: docs.id });
      if (!tools.ok) {
        throw new Error(tools.error.message);
      }
      own.forgetSessions();
      const before = own.stats.toolCalls;
      expect(
        await tools.value.docs__echo?.execute?.({ text: "again" }, {
          messages: [],
          toolCallId: "c1",
        } as never)
      ).toMatchObject({ content: [{ text: "again" }] });
      // Answered 404 first, so it ran exactly once, on the new session.
      expect(own.stats.toolCalls - before).toBe(1);
      expect(own.stats.initializes).toBe(2);
    } finally {
      await own.close();
    }
  });

  it("backs off from a server that keeps failing", async () => {
    let clock = 0;
    const down = instance("http://127.0.0.1:9/mcp", "down");
    const manager = managerFor([down], {
      circuit: { maxFailedRounds: 2 },
      now: () => clock,
      timeouts: { initMs: 2000 },
    });
    const first = await manager.status(down.id, alice);
    expect(first).toMatchObject({ state: "error" });
    clock += 1;
    await manager.status(down.id, alice);
    clock += 1;
    // Breaker open: answers from memory, no connection attempt.
    const started = Date.now();
    expect(await manager.status(down.id, alice)).toEqual(first);
    expect(Date.now() - started).toBeLessThan(50);
    const tools = await manager.toolSource(alice).tools({ id: down.id });
    expect(tools).toMatchObject({ error: { type: "unavailable" }, ok: false });
  });

  it("evicts idle per-user connections and renews stale ones", async () => {
    let clock = 0;
    const notes = libraryServer({
      auth: { type: "none" },
      transport: "http",
      url: fixture.url,
    });
    const shared = instance(fixture.url);
    const manager = managerFor([notes, shared], {
      idleTimeoutMs: 1000,
      now: () => clock,
    });
    await manager.status(notes.id, alice);
    await manager.status(shared.id, alice);
    expect(manager.openConnections()).toBe(2);
    clock = 5000;
    expect(await manager.evictIdle()).toBe(1);
    // Shared connections stay; they serve everyone.
    expect(manager.openConnections()).toBe(1);
  });

  it("renews a connection when the server's definition changes", async () => {
    const own = await startMcpFixture();
    try {
      let current = instance(own.url);
      const manager = createMcpManager({
        allowPrivateNetworks: true,
        clientName: "test-client",
        resolveServer: () => Promise.resolve(ok(current)),
        sweepIntervalMs: 0,
      });
      managers.push(manager);
      await manager.status(current.id, alice);
      current = { ...current, headers: { "x-extra": "1" }, version: "v2" };
      await manager.status(current.id, alice);
      expect(own.stats.initializes).toBe(2);
      expect(manager.openConnections()).toBe(1);
    } finally {
      await own.close();
    }
  });

  it("sends a sealed header secret, and degrades without keys", async () => {
    const own = await startMcpFixture({
      requireHeader: { name: "x-api-key", value: "fixture-secret" },
    });
    try {
      const keys = keyRingOf(randomBytes(32));
      const sealed = seal(keys, "fixture-secret", MCP_HEADER_SECRET_AAD);
      const guarded = libraryServer(
        {
          auth: { configured: true, headerName: "x-api-key", type: "header" },
          transport: "http",
          url: own.url,
        },
        { secretCiphertext: sealed.ciphertext, secretKeyId: sealed.keyId }
      );
      const withKeys = managerFor([guarded], { keys: ok(keys) });
      expect(await withKeys.status(guarded.id, alice)).toMatchObject({
        state: "connected",
      });
      const withoutKeys = managerFor([guarded]);
      expect(await withoutKeys.status(guarded.id, alice)).toMatchObject({
        state: "error",
      });
    } finally {
      await own.close();
    }
  });

  it("refuses private addresses for library servers unless allowed", async () => {
    const notes = libraryServer({
      auth: { type: "none" },
      transport: "http",
      url: fixture.url,
    });
    const manager = managerFor([notes], { allowPrivateNetworks: false });
    expect(await manager.status(notes.id, alice)).toEqual({
      message: "This MCP server's address is on a private network.",
      state: "error",
    });
  });

  it("skips a broken server without failing the tool set", async () => {
    const docs = instance(fixture.url);
    const manager = managerFor([docs]);
    const missing = newId("libraryItem");
    const built = await buildToolSet(
      planFor([{ id: docs.id }, { id: missing }]),
      {
        builtins: {},
        mcp: manager.toolSource(alice),
      }
    );
    expect(Object.keys(built.tools)).toHaveLength(3);
    expect(built.skipped).toEqual([
      { name: missing, reason: "mcp_unavailable" },
    ]);
  });
});
