import { WEB_SEARCH_TOOL } from "@workspace/ai/decider/retrieval-gate";
import { createMemoryProviderRegistry } from "@workspace/ai/ports/provider-registry.memory";
import { createMemorySearchBackend } from "@workspace/ai/ports/search-backend.memory";
import { chooseWebSearch } from "@workspace/ai/search/choose";
import { textStream, toolCallStream } from "@workspace/ai/testing/mock-models";
import {
  CREATE_ARTIFACT_TOOL,
  UPDATE_ARTIFACT_TOOL,
} from "@workspace/ai/tools/artifacts";
import { appConfigSchema } from "@workspace/config/schema";
import type {
  ArtifactId,
  ConversationId,
  MessageId,
  RunId,
  UserId,
} from "@workspace/contract/schemas/common";
import type { Conversation } from "@workspace/contract/schemas/conversations";
import type {
  CreateRunOutput,
  RunOptions,
} from "@workspace/contract/schemas/runs";
import {
  listArtifacts,
  listArtifactVersions,
} from "@workspace/db/queries/artifacts";
import { upsertGrant } from "@workspace/db/queries/grants";
import { createMcpServer } from "@workspace/db/queries/library";
import { getMessage } from "@workspace/db/queries/messages";
import { getRun } from "@workspace/db/queries/runs";
import {
  createTestDb,
  expectOk,
  seedOrg,
  seedUser,
  type TestDb,
} from "@workspace/db/testing";
import {
  connectorHandlers,
  mcpSelectionFor,
} from "@workspace/mcp/connector-service";
import { createMcp } from "@workspace/mcp/create";
import { listUsableServers } from "@workspace/mcp/manager";
import {
  type McpFixture,
  startMcpFixture,
} from "@workspace/mcp/testing/fixture-server";
import { MockLanguageModelV4 } from "ai/test";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createApp } from "../app";
import { createServices, type ServicesOptions } from "../services";
import { testConfig, USER_HEADER } from "../testing/harness";

// The harness gaps the audit found (078), each through a real run on
// PGlite with a scripted model: a plain chat searches the web over the
// configured backend, gets the MCP servers its caller may use (and nobody
// else's), saves artifacts through the approval it asks for, and stops at
// `limits.agentMaxSteps`.

const MODEL = "test:chat";

let testDb: TestDb;
let openServer: McpFixture;
let notesServer: McpFixture;
beforeAll(async () => {
  [testDb, openServer, notesServer] = await Promise.all([
    createTestDb(),
    startMcpFixture(),
    startMcpFixture(),
  ]);
}, 60_000);
afterAll(async () => {
  await Promise.all([testDb.close(), openServer.close(), notesServer.close()]);
});

const someone = async (): Promise<UserId> => {
  const row = await seedUser(testDb.db);
  await seedOrg(testDb.db, row.id, { isPersonal: true });
  return row.id;
};

/** A model that plays `steps` in order, one per call, then says it's done. */
const scripted = (
  steps: readonly (() => ReturnType<typeof toolCallStream>)[]
) => {
  let calls = 0;
  return new MockLanguageModelV4({
    doStream: () => {
      const step = steps[calls];
      calls += 1;
      return Promise.resolve(step ? step() : textStream("Done."));
    },
  });
};

/** The tools a model call was offered, by name. */
const offered = (model: MockLanguageModelV4, call = 0): string[] =>
  (model.doStreamCalls[call]?.tools ?? []).map((tool) => tool.name).sort();

const setup = (
  model: MockLanguageModelV4,
  options: Partial<Pick<ServicesOptions, "config" | "tools">> = {}
) => {
  const services = createServices({
    config: options.config ?? testConfig(),
    db: testDb.db,
    jobs: null,
    registry: createMemoryProviderRegistry({
      keyless: ["test"],
      languageModels: { [MODEL]: model },
    }),
    tools: options.tools,
  });
  const app = createApp({
    resolveSession: (request) => {
      const userId = request.headers.get(USER_HEADER);
      return Promise.resolve(userId ? { userId: userId as UserId } : null);
    },
    services,
  });
  const post = async <T>(userId: UserId, path: string, json: unknown) => {
    const response = await app.request(path, {
      body: JSON.stringify(json),
      headers: { "content-type": "application/json", [USER_HEADER]: userId },
      method: "POST",
    });
    if (response.status >= 300) {
      throw new Error(`${path} answered ${response.status}`);
    }
    return (await response.json()) as T;
  };
  /** Sends one message in a plain chat and waits for the run to stop. */
  const say = async (
    userId: UserId,
    text: string,
    at: {
      readonly conversationId?: ConversationId;
      readonly options?: Partial<RunOptions>;
      readonly parentId?: MessageId | null;
    } = {}
  ) => {
    const conversationId =
      at.conversationId ??
      (await post<Conversation>(userId, "/api/conversations", {})).id;
    const { runId } = await post<CreateRunOutput>(userId, "/api/runs", {
      conversationId,
      input: {
        parentId: at.parentId ?? null,
        parts: [{ text, type: "text" }],
        type: "message",
      },
      options: at.options,
      target: { model: MODEL, type: "model" },
    });
    await services.executor.idle();
    return { conversationId, runId: runId as RunId };
  };
  const answerOf = async (runId: RunId) => {
    const run = expectOk(await getRun(testDb.db, runId));
    return {
      answer: expectOk(
        await getMessage(testDb.db, run.assistantMessageId as MessageId)
      ),
      run,
    };
  };
  /** Approves every call the run waits on, and waits for it to stop again. */
  const approve = async (runId: RunId, userId: UserId) => {
    const { run } = await answerOf(runId);
    if (run.status !== "awaiting_approval") {
      throw new Error(`the run is ${run.status}, not waiting on anyone`);
    }
    expectOk(
      await services.executor.submitApprovals(
        runId,
        (run.approvals ?? []).map(({ toolCallId }) => ({
          decision: { decision: "approve" as const },
          toolCallId,
        })),
        userId
      )
    );
    await services.executor.idle();
  };
  return { answerOf, approve, post, say, services };
};

describe("web search in runs", () => {
  const doc = {
    publishedAt: null,
    snippet: "Postgres 18 adds asynchronous I/O.",
    title: "Postgres 18 released",
    url: "https://example.org/pg18",
  };
  const webSearch = () => {
    const backend = createMemorySearchBackend([doc]);
    const config = testConfig();
    return {
      backend,
      source: (model: string) => {
        const choice = chooseWebSearch({ backend, config, model });
        return choice.kind === "none" ? null : choice.tool;
      },
    };
  };

  it("gives a plain chat web_search over the backend, with its citations", async () => {
    const { backend, source } = webSearch();
    const model = scripted([
      () => toolCallStream(WEB_SEARCH_TOOL, { query: "postgres 18" }),
    ]);
    const { answerOf, say, services } = setup(model, {
      tools: { webSearch: source },
    });
    try {
      const { runId } = await say(await someone(), "What's new in Postgres?");
      const { answer, run } = await answerOf(runId);
      expect(run.status).toBe("succeeded");
      expect(offered(model)).toContain(WEB_SEARCH_TOOL);
      expect(backend.queries).toEqual(["postgres 18"]);
      // The model read the result, and the answer keeps it as a citation.
      expect(JSON.stringify(model.doStreamCalls[1]?.prompt)).toContain(
        doc.snippet
      );
      expect(answer.parts.filter((part) => part.type === "source")).toEqual([
        {
          id: "call-1-1",
          source: { kind: "url", title: doc.title, url: doc.url },
          type: "source",
        },
      ]);
    } finally {
      await services.stop();
    }
  });

  it("leaves it out when the composer turned web search off", async () => {
    const { source } = webSearch();
    const model = scripted([]);
    const { say, services } = setup(model, { tools: { webSearch: source } });
    try {
      await say(await someone(), "No searching.", {
        options: { webSearch: "off" },
      });
      expect(offered(model)).not.toContain(WEB_SEARCH_TOOL);
    } finally {
      await services.stop();
    }
  });
});

describe("a call the run can't make (131)", () => {
  const source = () => {
    const backend = createMemorySearchBackend([]);
    const config = testConfig();
    return (model: string) => {
      const choice = chooseWebSearch({ backend, config, model });
      return choice.kind === "none" ? null : choice.tool;
    };
  };
  /** The answer's tool call and its result, as stored. */
  const callAndResult = (parts: readonly { readonly type: string }[]) =>
    parts.filter(
      (part) => part.type === "tool-call" || part.type === "tool-result"
    );

  it("answers a call to a withheld tool with an error, and the run goes on", async () => {
    const model = scripted([
      () => toolCallStream(WEB_SEARCH_TOOL, { query: "postgres 18" }),
    ]);
    const { answerOf, say, services } = setup(model, {
      tools: { webSearch: source() },
    });
    try {
      const { runId } = await say(await someone(), "No searching.", {
        options: { webSearch: "off" },
      });
      const { answer, run } = await answerOf(runId);
      expect(offered(model)).not.toContain(WEB_SEARCH_TOOL);
      expect(run.status).toBe("succeeded");
      expect(model.doStreamCalls).toHaveLength(2);
      expect(JSON.stringify(model.doStreamCalls[1]?.prompt)).toContain(
        `unavailable tool '${WEB_SEARCH_TOOL}'`
      );
      expect(callAndResult(answer.parts)).toEqual([
        expect.objectContaining({
          input: { query: "postgres 18" },
          toolName: WEB_SEARCH_TOOL,
          type: "tool-call",
        }),
        expect.objectContaining({
          output: {
            message: expect.stringContaining(
              `unavailable tool '${WEB_SEARCH_TOOL}'`
            ),
            status: "error",
          },
          type: "tool-result",
        }),
      ]);
      expect(answer.parts.at(-1)).toMatchObject({
        text: "Done.",
        type: "text",
      });
    } finally {
      await services.stop();
    }
  });

  it("answers input that doesn't fit the schema with an error the model can correct", async () => {
    const model = scripted([
      () => toolCallStream(WEB_SEARCH_TOOL, { query: 42 }),
    ]);
    const { answerOf, say, services } = setup(model, {
      tools: { webSearch: source() },
    });
    try {
      const { runId } = await say(await someone(), "Search for 42.");
      const { answer, run } = await answerOf(runId);
      expect(run.status).toBe("succeeded");
      expect(JSON.stringify(model.doStreamCalls[1]?.prompt)).toContain(
        `Invalid input for tool ${WEB_SEARCH_TOOL}`
      );
      expect(callAndResult(answer.parts)).toEqual([
        expect.objectContaining({ input: { query: 42 }, type: "tool-call" }),
        expect.objectContaining({
          output: {
            message: expect.stringContaining(
              `Invalid input for tool ${WEB_SEARCH_TOOL}`
            ),
            status: "error",
          },
          type: "tool-result",
        }),
      ]);
    } finally {
      await services.stop();
    }
  });
});

describe("MCP in plain chats", () => {
  it("offers the caller's servers, runs a tool once approved, and keeps other people's away", async () => {
    const { db } = testDb;
    const [alice, carol, stranger] = await Promise.all([
      someone(),
      someone(),
      someone(),
    ]);
    const mcp = createMcp({
      allowPrivateNetworks: true,
      config: {
        brand: { name: "Test" } as never,
        mcp: appConfigSchema.shape.mcp.parse({
          servers: [{ name: "open", url: openServer.url }],
        }),
      },
      db,
      env: {},
    });
    const notes = await createMcpServer(db, {
      createdBy: alice,
      definition: {
        auth: { type: "none" },
        kind: "mcp_server",
        transport: "http",
        url: notesServer.url,
      },
      name: "Notes",
      owner: { id: alice, type: "user" },
    });
    expectOk(
      await upsertGrant(db, {
        grantedBy: alice,
        permission: "use",
        principal: { id: carol, type: "user" },
        resource: { resourceId: notes.id, resourceType: "mcp_server" },
      })
    );
    const usable = async (userId: UserId) => ({
      disabled: new Set<never>(),
      enabled: await listUsableServers(
        { db, instanceServers: mcp.registry.instanceServers },
        userId
      ),
      excludedTools: new Map(),
    });
    const chat = async (userId: UserId) => {
      const model = scripted([
        () => toolCallStream("open__echo", { text: "hello from mcp" }),
      ]);
      const { answerOf, approve, say, services } = setup(model, {
        tools: {
          mcpFor: (id) => mcp.manager.toolSource(id),
          mcpSelectionFor: usable,
        },
      });
      try {
        const { runId } = await say(userId, "Echo something.");
        // Every MCP call in a plain chat waits for a person; until then
        // the server hasn't been called.
        const paused = await answerOf(runId);
        const callsBefore = openServer.stats.toolCalls;
        if (paused.run.status === "awaiting_approval") {
          await approve(runId, userId);
        }
        return {
          ...(await answerOf(runId)),
          callsAfter: openServer.stats.toolCalls,
          callsBefore,
          model,
          paused,
        };
      } finally {
        await services.stop();
      }
    };

    try {
      // The owner and the grantee get the instance's server and Alice's.
      for (const userId of [alice, carol]) {
        const started = openServer.stats.toolCalls;
        // biome-ignore lint/performance/noAwaitInLoops: one chat at a time keeps the script simple.
        const chatted = await chat(userId);
        const { answer, callsAfter, callsBefore, model, paused, run } = chatted;
        // It asked, and nothing ran until the answer was yes.
        expect(paused.run.status).toBe("awaiting_approval");
        expect(paused.run.approvals).toMatchObject([
          { toolName: "open__echo" },
        ]);
        expect(callsBefore).toBe(started);
        expect(callsAfter).toBe(started + 1);
        expect(run.status).toBe("succeeded");
        expect(offered(model)).toEqual(
          expect.arrayContaining(["notes__echo", "open__add", "open__echo"])
        );
        expect(
          answer.parts.find((part) => part.type === "tool-call")
        ).toMatchObject({
          approval: {
            decidedBy: userId,
            decision: { decision: "approve" },
            state: "decided",
          },
          toolName: "open__echo",
        });
        expect(JSON.stringify(model.doStreamCalls[1]?.prompt)).toContain(
          "hello from mcp"
        );
      }
      // Anyone else gets the instance's only.
      const other = await chat(stranger);
      expect(offered(other.model)).toContain("open__echo");
      expect(
        offered(other.model).filter((name) => name.startsWith("notes__"))
      ).toEqual([]);
      expect(await usable(stranger)).toEqual(
        mcp.registry.instanceServers.map((server) => server.id)
      );
      expect(await usable(alice)).toContain(notes.id);

      // An org's server is its members', through the org they act as.
      const org = await seedOrg(db, carol);
      const shared = await createMcpServer(db, {
        createdBy: carol,
        definition: {
          auth: { type: "none" },
          kind: "mcp_server",
          transport: "http",
          url: notesServer.url,
        },
        name: "Org tools",
        owner: { id: org.id, type: "org" },
      });
      expect(await usable(carol)).toEqual(
        expect.arrayContaining([notes.id, shared.id])
      );
      expect(await usable(alice)).not.toContain(shared.id);
      expect(await usable(stranger)).not.toContain(shared.id);
    } finally {
      await mcp.manager.close();
    }
  });
});

describe("connector switches at runtime (188)", () => {
  it("hands the model only the tools on in that chat", async () => {
    const { db } = testDb;
    const ada = await someone();
    const config = appConfigSchema.shape.mcp.parse({
      servers: [{ name: "open", url: openServer.url }],
    });
    const mcp = createMcp({
      allowPrivateNetworks: true,
      config: { brand: { name: "Test" } as never, mcp: config },
      db,
      env: {},
    });
    const deps = {
      catalog: mcp.registry.catalog,
      db,
      userServers: config.userServers,
    };
    const model = scripted([]);
    const { post, say, services } = setup(model, {
      tools: {
        mcpFor: (id) => mcp.manager.toolSource(id),
        mcpSelectionFor: (userId, conversationId) =>
          mcpSelectionFor(deps, { conversationId, userId }),
      },
    });
    try {
      const chat = await post<Conversation>(ada, "/api/conversations", {});
      const id = mcp.registry.instanceServers[0]?.id;
      if (!id) {
        throw new Error("no instance server");
      }
      expectOk(
        await connectorHandlers.setToolEnabled(
          deps,
          { userId: ada },
          { conversationId: chat.id, enabled: false, id, tool: "add" }
        )
      );
      await say(ada, "Hello.", { conversationId: chat.id });
      expect(offered(model)).toContain("open__echo");
      expect(offered(model)).not.toContain("open__add");

      // Another chat follows the defaults: everything on.
      await say(ada, "Hello again.");
      expect(offered(model, 1)).toContain("open__add");
    } finally {
      await services.stop();
      await mcp.manager.close();
    }
  });
});

describe("artifacts at runtime", () => {
  const page = "<!doctype html><html><body><h1>Hello</h1></body></html>";

  it("creates an artifact and then its next version, each once approved", async () => {
    const { db } = testDb;
    const ada = await someone();
    let artifactId: ArtifactId | undefined;
    const model = scripted([
      () =>
        toolCallStream(CREATE_ARTIFACT_TOOL, {
          content: page,
          title: "Landing page",
          type: "html",
        }),
      // The first turn's closing words.
      () => textStream("Made it."),
      () =>
        // Its own call id, as a provider gives every call.
        toolCallStream(
          UPDATE_ARTIFACT_TOOL,
          { artifactId, content: page.replace("Hello", "Hello again") },
          "call-2"
        ),
    ]);
    const { answerOf, approve, say, services } = setup(model);
    try {
      const first = await say(ada, "Make me a landing page.");
      // Nothing is saved until someone says yes.
      expect(await listArtifacts(db, first.conversationId)).toEqual([]);
      await approve(first.runId, ada);
      const created = await answerOf(first.runId);
      expect(created.run.status).toBe("succeeded");
      const [artifact] = await listArtifacts(db, first.conversationId);
      expect(artifact).toMatchObject({
        kind: "html",
        messageId: created.answer.id,
        title: "Landing page",
      });
      artifactId = artifact?.id;
      if (!artifactId) {
        throw new Error("no artifact was saved");
      }
      // The card sits right after the call that made it.
      const types = created.answer.parts.map((part) => part.type);
      expect(types[types.indexOf("tool-result") + 1]).toBe("artifact-ref");
      expect(
        created.answer.parts.find((part) => part.type === "artifact-ref")
      ).toEqual({
        artifactId,
        kind: "html",
        title: "Landing page",
        type: "artifact-ref",
        versionId: artifact?.latestVersionId,
      });

      const second = await say(ada, "Greet them again.", {
        conversationId: first.conversationId,
        parentId: created.answer.id,
      });
      await approve(second.runId, ada);
      const updated = await answerOf(second.runId);
      expect(updated.run.status).toBe("succeeded");
      const versions = await listArtifactVersions(db, artifactId);
      expect(
        versions.map(({ content, messageId, number }) => ({
          content,
          messageId,
          number,
        }))
      ).toEqual([
        { content: page, messageId: created.answer.id, number: 1 },
        {
          content: page.replace("Hello", "Hello again"),
          messageId: updated.answer.id,
          number: 2,
        },
      ]);
      expect(
        updated.answer.parts.find((part) => part.type === "artifact-ref")
      ).toMatchObject({ artifactId, versionId: versions[1]?.id });
    } finally {
      await services.stop();
    }
  });
});

describe("limits.agentMaxSteps", () => {
  it("stops the agent loop at the configured step", async () => {
    const backend = createMemorySearchBackend([]);
    const base = testConfig();
    const config = {
      ...base,
      limits: { ...base.limits, agentMaxSteps: 3 },
    };
    // A model that would search forever.
    const model = new MockLanguageModelV4({
      doStream: () =>
        Promise.resolve(toolCallStream(WEB_SEARCH_TOOL, { query: "again" })),
    });
    const { answerOf, say, services } = setup(model, {
      config,
      tools: {
        webSearch: (ref) => {
          const choice = chooseWebSearch({ backend, config, model: ref });
          return choice.kind === "none" ? null : choice.tool;
        },
      },
    });
    try {
      const { runId } = await say(await someone(), "Keep searching.");
      expect((await answerOf(runId)).run.status).toBe("succeeded");
      expect(model.doStreamCalls).toHaveLength(3);
    } finally {
      await services.stop();
    }
  });
});
