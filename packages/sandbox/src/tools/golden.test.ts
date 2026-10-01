import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createMemoryKeyStore } from "@workspace/ai/keys/key-store.memory";
import { createMemoryProviderRegistry } from "@workspace/ai/ports/provider-registry.memory";
import { createMemorySearchBackend } from "@workspace/ai/ports/search-backend.memory";
import { createAiSdkEmbedder } from "@workspace/ai/rag/embedder";
import { INGEST_FILE_JOB } from "@workspace/ai/rag/ingest";
import { createHashEmbeddingModel } from "@workspace/ai/rag/mock-embedding-model";
import { chooseWebSearch } from "@workspace/ai/search/choose";
import { textStream } from "@workspace/ai/testing/mock-models";
import { createArtifactTools } from "@workspace/ai/tools/artifacts";
import { resolveTools } from "@workspace/ai/tools/resolve";
import { buildToolSet } from "@workspace/ai/tools/tool-set";
import type { LibraryItemId, UserId } from "@workspace/contract/schemas/common";
import type { Conversation } from "@workspace/contract/schemas/conversations";
import type { AgentDefinition } from "@workspace/contract/schemas/library";
import type { RunTarget } from "@workspace/contract/schemas/runs";
import {
  createVersionedItem,
  publishDraft,
} from "@workspace/db/queries/library";
import { setMemoryMode } from "@workspace/db/queries/memory";
import { loadPrincipals } from "@workspace/db/queries/teams";
import {
  createTestDb,
  expectOk,
  seedOrg,
  seedUser,
  type TestDb,
} from "@workspace/db/testing";
import { createMcp } from "@workspace/mcp/create";
import { instanceServerId } from "@workspace/mcp/server-config";
import {
  type McpFixture,
  startMcpFixture,
} from "@workspace/mcp/testing/fixture-server";
import { createApp } from "@workspace/server/app";
import { createFileHandlers } from "@workspace/server/knowledge/files";
import {
  createKnowledgeJobs,
  type KnowledgeJobs,
} from "@workspace/server/knowledge/ingestion";
import { createMemoryJobQueue } from "@workspace/server/ports/job-queue.memory";
import { withChatMemory } from "@workspace/server/runs/memory";
import {
  createTurnResolver,
  type Turn,
  type TurnResolverDeps,
} from "@workspace/server/runs/turn";
import { createServices, dbArtifactStore } from "@workspace/server/services";
import { createLocalStorage } from "@workspace/server/storage/local";
import { testConfig, USER_HEADER } from "@workspace/server/testing/harness";
import { ok } from "@workspace/shared/result";
import { asSchema, type Tool } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createTurnSandboxSource } from "../handlers/turn-tools";
import { createJustBashFactory } from "../just-bash/provider";
import { createMemorySnapshotStore } from "../just-bash/snapshot-store";
import type { SandboxProviders } from "../providers";

// The golden snapshot of every tool a run can be given (080): its name,
// description and input schema as the model is sent them, and its approval
// setting as the executor gets it. Each turn is resolved for real (the
// production resolver and memory wrapper over PGlite, the just-bash
// sandbox, an in-process MCP server) and run against a mock model, which
// records the tools it was offered. The tool registry moves where tools are
// written down; this file must not change when it does.

const MODEL = "test:chat";
// Not `.json`: the formatter would rewrite what the test writes.
const SNAPSHOT = "./__snapshots__/tool-golden.json.snap";

let testDb: TestDb;
let mcpServer: McpFixture;
let root: string;
beforeAll(async () => {
  [testDb, mcpServer, root] = await Promise.all([
    createTestDb(),
    startMcpFixture(),
    mkdtemp(join(tmpdir(), "tool-golden-test-")),
  ]);
}, 60_000);
afterAll(async () => {
  await Promise.all([
    testDb.close(),
    mcpServer.close(),
    rm(root, { force: true, recursive: true }),
  ]);
});

const embedder = createAiSdkEmbedder({
  dimensions: 384,
  model: createHashEmbeddingModel({ dimensions: 384 }),
  ref: "test:hash",
});

const someone = async (): Promise<UserId> => {
  const row = await seedUser(testDb.db);
  await seedOrg(testDb.db, row.id, { isPersonal: true });
  return row.id;
};

/** Uploads a PDF to the chat and indexes it, the way the `files` routes do. */
const attach = async (userId: UserId, conversationId: Conversation["id"]) => {
  const { db } = testDb;
  const queue = createMemoryJobQueue<KnowledgeJobs>();
  const storage = createLocalStorage({
    baseUrl: "http://localhost:3000/api/storage",
    root,
    signingSecret: "test-signing-secret",
  });
  const jobs = createKnowledgeJobs({ db, embedder, queue, storage });
  await queue.work(INGEST_FILE_JOB, jobs[INGEST_FILE_JOB]);
  const files = createFileHandlers({
    config: testConfig(),
    db,
    embedder,
    queue,
    storage: { driver: "local", storage },
  });
  const pdf = await readFile(
    new URL("../../../ai/src/rag/__fixtures__/two-pages.pdf", import.meta.url)
  );
  expectOk(
    await files.upload(
      { viewer: { principals: await loadPrincipals(db, userId), userId } },
      {
        conversationId,
        file: new File([pdf], "handbook.pdf", { type: "application/pdf" }),
        purpose: "attachment",
      }
    )
  );
  await queue.drain();
};

const justBash = (): SandboxProviders =>
  new Map([
    [
      "just-bash",
      {
        factory: createJustBashFactory({ store: createMemorySnapshotStore() }),
        isolation: () => Promise.resolve(ok("simulated" as const)),
        limits: { cpu: 1, diskMb: 64, memoryMb: 256, network: false },
      },
    ],
  ]);

const json = (value: unknown): unknown =>
  JSON.parse(JSON.stringify(value ?? null));

/** A tool's output schema as JSON Schema; `null` when it declares none. */
const outputSchemaOf = (tool: Tool | undefined): unknown =>
  tool?.outputSchema ? json(asSchema(tool.outputSchema).jsonSchema) : null;

interface Seen {
  /** `Turn.toolApproval[name]`; `null` when the turn says nothing for it. */
  readonly approval: unknown;
  /** Whether the model reads a rendering of the result instead of its JSON. */
  readonly customModelOutput: boolean;
  /** The function tool as the provider call carries it. */
  readonly model: unknown;
  readonly name: string;
  readonly outputSchema: unknown;
}

/**
 * Runs one message against `target` with every tool source the shell can
 * bind, and returns what the model and the executor were each handed.
 */
const toolsOfTurn = async (
  userId: UserId,
  target: RunTarget,
  { attachment }: { readonly attachment: boolean }
): Promise<readonly Seen[]> => {
  const { db } = testDb;
  const config = testConfig();
  const model = new MockLanguageModelV4({
    doStream: () => Promise.resolve(textStream("Done.")),
  });
  const registry = createMemoryProviderRegistry({
    keyless: ["test"],
    languageModels: { [MODEL]: model },
  });
  const mcp = createMcp({
    allowPrivateNetworks: true,
    config: {
      brand: { name: "Test" } as never,
      mcp: {
        servers: [
          { headers: {}, name: "open", transport: "http", url: mcpServer.url },
        ],
      },
    },
    db,
    env: {},
  });
  const backend = createMemorySearchBackend([]);
  // What `createServices` binds (`turnDeps`), spelled out so the resolved
  // turn can be read before the executor takes it.
  const deps: TurnResolverDeps = {
    artifacts: (run) => createArtifactTools(dbArtifactStore(db, run)),
    config,
    db,
    keyStore: createMemoryKeyStore([]),
    knowledge: { embedder },
    mcpFor: (id) => mcp.manager.toolSource(id),
    mcpServersFor: () =>
      Promise.resolve(mcp.registry.instanceServers.map((server) => server.id)),
    registry,
    sandbox: createTurnSandboxSource({
      db,
      defaultProvider: "just-bash",
      providers: justBash(),
    }),
    webSearch: (ref) => {
      const choice = chooseWebSearch({ backend, config, model: ref });
      return choice.kind === "none" ? null : choice.tool;
    },
  };
  const resolve = withChatMemory(createTurnResolver(deps), {
    db,
    settings: {
      enabled: config.features.memory,
      maxChars: config.limits.memoryMaxChars,
    },
  });
  let turn: Turn | undefined;
  const services = createServices({
    // Memory is already in `resolve`; the services' own wrapper stays out.
    config: { ...config, features: { ...config.features, memory: false } },
    db,
    jobs: null,
    registry,
    resolveTurn: async (run, options) => {
      const resolved = await resolve(run, options);
      if (resolved.ok) {
        turn = resolved.value;
      }
      return resolved;
    },
  });
  const app = createApp({
    resolveSession: (request) => {
      const id = request.headers.get(USER_HEADER);
      return Promise.resolve(id ? { userId: id as UserId } : null);
    },
    services,
  });
  const post = async <T>(path: string, body: unknown): Promise<T> => {
    const response = await app.request(path, {
      body: JSON.stringify(body),
      headers: { "content-type": "application/json", [USER_HEADER]: userId },
      method: "POST",
    });
    if (response.status >= 300) {
      throw new Error(`${path} answered ${response.status}`);
    }
    return (await response.json()) as T;
  };
  try {
    const chat = await post<Conversation>("/api/conversations", {});
    if (attachment) {
      await attach(userId, chat.id);
    }
    await post("/api/runs", {
      conversationId: chat.id,
      input: {
        parentId: null,
        parts: [{ text: "Hello.", type: "text" }],
        type: "message",
      },
      target,
    });
    await services.executor.idle();
    const offered = model.doStreamCalls[0]?.tools ?? [];
    // The model and the executor were handed the same set.
    const given = Object.keys(turn?.tools ?? {}).sort();
    if (
      offered
        .map((tool) => tool.name)
        .sort()
        .join() !== given.join()
    ) {
      throw new Error(`the model wasn't offered the turn's tools: ${given}`);
    }
    return offered
      .map((tool) => ({
        approval: turn?.toolApproval?.[tool.name] ?? null,
        customModelOutput:
          typeof turn?.tools?.[tool.name]?.toModelOutput === "function",
        model: json(tool),
        name: tool.name,
        outputSchema: outputSchemaOf(turn?.tools?.[tool.name]),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  } finally {
    await services.stop();
    await mcp.manager.close();
  }
};

/** An agent that names every built-in and the instance's MCP server. */
const publishedAgent = async (
  ownerId: UserId,
  approvals: AgentDefinition["approvals"]
): Promise<RunTarget> => {
  const definition: AgentDefinition = {
    approvals,
    conversationStarters: [],
    instructions: "You work in the sandbox.",
    kind: "agent",
    knowledgeFileIds: [],
    mcpServers: [{ id: instanceServerId("open") }],
    model: MODEL,
    parameters: {},
    sandboxProvider: "just-bash",
    skills: [],
    tools: [
      "bash",
      "read",
      "write",
      "edit",
      "preview",
      "file_search",
      "web_search",
      "create_artifact",
      "update_artifact",
    ],
  };
  const { item } = await createVersionedItem(testDb.db, "agent", {
    createdBy: ownerId,
    definition,
    name: "Everything",
    owner: { id: ownerId, type: "user" },
  });
  const id = item.id as LibraryItemId;
  expectOk(
    await publishDraft(testDb.db, "agent", id, { publishedBy: ownerId })
  );
  return { id, type: "agent" };
};

/** A client tool through `buildToolSet`, the only way one reaches a tool set. */
const clientTools = async (): Promise<readonly unknown[]> => {
  const plan = resolveTools(
    {
      approvals: { default: "ask", tools: {} },
      mcpServers: [],
      sandboxProvider: null,
      tools: [],
    },
    { builtins: new Set(), modelSupportsTools: true },
    { mcpServers: new Set() }
  );
  const built = await buildToolSet(plan, {
    builtins: {},
    client: [
      {
        description: "Ask the user to pick a folder on their machine.",
        inputSchema: {
          additionalProperties: false,
          properties: { title: { type: "string" } },
          required: ["title"],
          type: "object",
        },
        name: "pick_folder",
      },
    ],
  });
  return Object.entries(built.tools).map(([name, tool]) => ({
    approval: built.toolApproval[name] ?? null,
    description: tool.description ?? null,
    hasExecute: typeof tool.execute === "function",
    inputSchema: json(asSchema(tool.inputSchema).jsonSchema),
    name,
    outputSchema: outputSchemaOf(tool),
  }));
};

describe("the tools a run can be given", () => {
  it("are what they were before the registry (names, descriptions, schemas, approvals)", async () => {
    const chatter = await someone();
    const proposer = await someone();
    await setMemoryMode(testDb.db, proposer, "propose");
    const builder = await someone();

    const golden = {
      // The same agent asking by default, with two overrides by name.
      agentAsk: (
        await toolsOfTurn(
          builder,
          await publishedAgent(builder, {
            default: "ask",
            tools: { create_artifact: "auto", write: "auto" },
          }),
          { attachment: false }
        )
      ).map(({ approval, name }) => ({ approval, name })),
      // An agent that lists every built-in, with its author's defaults.
      agentAuto: await toolsOfTurn(
        builder,
        await publishedAgent(builder, { default: "auto", tools: {} }),
        { attachment: false }
      ),
      clientTools: await clientTools(),
      // A plain chat: its workspace, the web, its attachments, the caller's
      // MCP servers, artifacts and memory.
      plainChat: await toolsOfTurn(
        chatter,
        { model: MODEL, type: "model" },
        { attachment: true }
      ),
      // The same chat for someone whose memory edits are proposed first.
      plainChatMemoryProposed: (
        await toolsOfTurn(
          proposer,
          { model: MODEL, type: "model" },
          { attachment: false }
        )
      ).filter((tool) => tool.name === "update_memory"),
    };
    // The snapshot has to list every kind of tool to be worth anything.
    const names = (tools: readonly { readonly name: string }[]) =>
      tools.map((tool) => tool.name);
    expect(names(golden.plainChat)).toEqual([
      "bash",
      "create_artifact",
      "edit",
      "file_search",
      "open__add",
      "open__echo",
      "open__whoami",
      "preview",
      "read",
      "update_artifact",
      "update_memory",
      "web_search",
      "write",
    ]);
    expect(names(golden.agentAuto)).toEqual(names(golden.plainChat));

    await expect(`${JSON.stringify(golden, null, 2)}\n`).toMatchFileSnapshot(
      SNAPSHOT
    );
  }, 120_000);
});
