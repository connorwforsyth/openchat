import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { FILE_SEARCH_TOOL } from "@workspace/ai/decider/retrieval-gate";
import { createMemoryKeyStore } from "@workspace/ai/keys/key-store.memory";
import { createFakeDecider } from "@workspace/ai/ports/decider.memory";
import { createMemoryProviderRegistry } from "@workspace/ai/ports/provider-registry.memory";
import type { RunStart } from "@workspace/ai/ports/run-executor";
import { createAiSdkEmbedder } from "@workspace/ai/rag/embedder";
import type { FileSearchToolOutput } from "@workspace/ai/rag/file-search";
import { INGEST_FILE_JOB } from "@workspace/ai/rag/ingest";
import { createHashEmbeddingModel } from "@workspace/ai/rag/mock-embedding-model";
import { textStream, toolCallStream } from "@workspace/ai/testing/mock-models";
import type {
  ConversationId,
  FileId,
  LibraryItemId,
  MessageId,
  RunId,
  UserId,
} from "@workspace/contract/schemas/common";
import type { Conversation } from "@workspace/contract/schemas/conversations";
import type { AgentDefinition } from "@workspace/contract/schemas/library";
import type { CreateRunOutput } from "@workspace/contract/schemas/runs";
import { createConversation } from "@workspace/db/queries/conversations";
import { upsertGrant } from "@workspace/db/queries/grants";
import {
  createVersionedItem,
  publishDraft,
} from "@workspace/db/queries/library";
import { getMessage } from "@workspace/db/queries/messages";
import { getRun } from "@workspace/db/queries/runs";
import { loadPrincipals } from "@workspace/db/queries/teams";
import {
  createTestDb,
  expectOk,
  seedOrg,
  seedUser,
  type TestDb,
} from "@workspace/db/testing";
import { newId } from "@workspace/shared/ids";
import type { ToolSet } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createApp } from "../app";
import { createFileHandlers } from "../knowledge/files";
import {
  createKnowledgeJobs,
  type KnowledgeJobs,
} from "../knowledge/ingestion";
import { createMemoryJobQueue } from "../ports/job-queue.memory";
import { createServices } from "../services";
import { createLocalStorage } from "../storage/local";
import { testConfig, USER_HEADER } from "../testing/harness";
import { withCitations } from "./executor";
import { createTurnResolver, type TurnResolverDeps } from "./turn";

// Agent knowledge in chat turns (ticket 036), end to end on PGlite +
// pgvector with a hash embedding model and a scripted chat model: the
// owner's knowledge PDF answers a `use`-only consumer through `file_search`,
// with a citation on the stored answer, while the file itself stays closed
// to them; and the Decider's retrieval gate can take the tool away.

const PDF = "application/pdf";

let testDb: TestDb;
let root: string;
beforeAll(async () => {
  testDb = await createTestDb();
  root = await mkdtemp(join(tmpdir(), "agent-knowledge-test-"));
}, 60_000);
afterAll(async () => {
  await testDb.close();
  await rm(root, { force: true, recursive: true });
});

const embedder = createAiSdkEmbedder({
  dimensions: 384,
  model: createHashEmbeddingModel({ dimensions: 384 }),
  ref: "test:hash",
});

const viewerOf = async (userId: UserId) => ({
  viewer: { principals: await loadPrincipals(testDb.db, userId), userId },
});

/** Each user's personal org, the context their chats and runs are in. */
const personalOrgs = new Map<UserId, Awaited<ReturnType<typeof seedOrg>>>();

const someone = async (): Promise<UserId> => {
  const row = await seedUser(testDb.db);
  personalOrgs.set(
    row.id,
    await seedOrg(testDb.db, row.id, { isPersonal: true })
  );
  return row.id;
};

const personalContext = (userId: UserId) => {
  const org = personalOrgs.get(userId);
  if (!org) {
    throw new Error("seed the user with `someone` first");
  }
  return { id: org.id, type: "personal" as const };
};

const definition = (knowledgeFileIds: readonly FileId[]): AgentDefinition => ({
  approvals: { default: "auto", tools: {} },
  conversationStarters: [],
  instructions: "Answer from the orchard handbook.",
  kind: "agent",
  knowledgeFileIds: [...knowledgeFileIds],
  mcpServers: [],
  model: "test:agent",
  parameters: {},
  sandboxProvider: null,
  skills: [],
  tools: [],
});

/** Files uploaded and indexed the way the `files` routes do it. */
const fileStore = async () => {
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
  const upload = async (
    userId: UserId,
    file: File,
    options: {
      readonly conversationId?: ConversationId;
      readonly purpose: "attachment" | "knowledge";
    }
  ): Promise<FileId> => {
    const record = expectOk(
      await files.upload(await viewerOf(userId), { ...options, file })
    );
    await queue.drain();
    return record.id;
  };
  return { files, upload };
};

const handbook = async () =>
  new File(
    [
      await readFile(
        new URL(
          "../../../ai/src/rag/__fixtures__/two-pages.pdf",
          import.meta.url
        )
      ),
    ],
    "handbook.pdf",
    { type: PDF }
  );

/** A published agent owned by `ownerId` whose knowledge is `fileIds`. */
const publishedAgent = async (
  ownerId: UserId,
  fileIds: readonly FileId[]
): Promise<LibraryItemId> => {
  const { item } = await createVersionedItem(testDb.db, "agent", {
    createdBy: ownerId,
    definition: definition(fileIds),
    name: "Orchard",
    owner: { id: ownerId, type: "user" },
  });
  const id = item.id as LibraryItemId;
  expectOk(
    await publishDraft(testDb.db, "agent", id, { publishedBy: ownerId })
  );
  return id;
};

const grantUse = async (
  ownerId: UserId,
  agentId: LibraryItemId,
  userId: UserId
) =>
  expectOk(
    await upsertGrant(testDb.db, {
      grantedBy: ownerId,
      permission: "use",
      principal: { id: userId, type: "user" },
      resource: { resourceId: agentId, resourceType: "agent" },
    })
  );

const resolverDeps = (
  model: MockLanguageModelV4,
  extra: Pick<TurnResolverDeps, "knowledge" | "retrieval"> = {
    knowledge: { embedder },
  }
): TurnResolverDeps => ({
  config: testConfig(),
  db: testDb.db,
  keyStore: createMemoryKeyStore([]),
  registry: createMemoryProviderRegistry({
    keyless: ["test"],
    languageModels: { "test:agent": model },
  }),
  ...extra,
});

describe("an agent's knowledge files in its turns", () => {
  it("answers a use-only consumer from the knowledge PDF, with a citation, without opening the file to them", async () => {
    const { db } = testDb;
    const owner = await someone();
    const bob = await someone();
    const { files, upload } = await fileStore();
    const pdf = await upload(owner, await handbook(), {
      purpose: "knowledge",
    });
    const agentId = await publishedAgent(owner, [pdf]);
    await grantUse(owner, agentId, bob);

    let calls = 0;
    const model = new MockLanguageModelV4({
      doStream: () => {
        calls += 1;
        return Promise.resolve(
          calls === 1
            ? toolCallStream(FILE_SEARCH_TOOL, {
                limit: 1,
                query: "persimmons",
              })
            : textStream("The handbook mentions persimmons on page two [1].")
        );
      },
    });
    const services = createServices({
      config: testConfig(),
      db,
      jobs: null,
      registry: createMemoryProviderRegistry({
        keyless: ["test"],
        languageModels: {},
      }),
      resolveTurn: createTurnResolver(resolverDeps(model)),
    });
    const app = createApp({
      resolveSession: (request) => {
        const userId = request.headers.get(USER_HEADER);
        return Promise.resolve(userId ? { userId: userId as UserId } : null);
      },
      services,
    });
    const asBob = (path: string, json: unknown) =>
      app.request(path, {
        body: JSON.stringify(json),
        headers: { "content-type": "application/json", [USER_HEADER]: bob },
        method: "POST",
      });

    try {
      const chat = (await (
        await asBob("/api/conversations", {})
      ).json()) as Conversation;
      const response = await asBob("/api/runs", {
        conversationId: chat.id,
        input: {
          parentId: null,
          parts: [{ text: "What does page two cover?", type: "text" }],
          type: "message",
        },
        target: { id: agentId, type: "agent" },
      });
      expect(response.status).toBe(202);
      const { runId } = (await response.json()) as CreateRunOutput;
      await services.executor.idle();

      const run = expectOk(await getRun(db, runId as RunId));
      expect(run.status).toBe("succeeded");
      // The model was handed the right passage from the file bob can't open.
      expect(JSON.stringify(model.doStreamCalls[1]?.prompt)).toContain(
        "Page two mentions persimmons."
      );
      const answer = expectOk(
        await getMessage(db, run.assistantMessageId as MessageId)
      );
      const result = answer.parts.find((part) => part.type === "tool-result");
      const output =
        result?.output.status === "success"
          ? (result.output.value as FileSearchToolOutput)
          : null;
      expect(output?.status === "ok" && output.hits[0]).toMatchObject({
        fileId: pdf,
        page: 2,
        text: "Page two mentions persimmons.",
      });
      expect(answer.parts.filter((part) => part.type === "source")).toEqual([
        {
          id: "call-1-1",
          source: expect.objectContaining({
            fileId: pdf,
            filename: "handbook.pdf",
            kind: "file",
            page: 2,
          }),
          type: "source",
        },
      ]);
      // The citation sits right after the result it came from.
      const types = answer.parts.map((part) => part.type);
      expect(types[types.indexOf("tool-result") + 1]).toBe("source");

      // Searching it through the agent opens nothing: the file is still
      // not bob's to see or download.
      const them = await viewerOf(bob);
      expect(await files.get(them, { id: pdf })).toEqual({
        error: { code: "NOT_FOUND" },
        ok: false,
      });
      expect(await files.getUrl(them, { id: pdf })).toMatchObject({
        error: { code: "NOT_FOUND" },
        ok: false,
      });
      expectOk(await files.get(await viewerOf(owner), { id: pdf }));
    } finally {
      await services.stop();
    }
  });
});

describe("the turn's file_search", () => {
  const runFor = (
    userId: UserId,
    agentId: LibraryItemId,
    conversationId: ConversationId
  ): RunStart => ({
    context: personalContext(userId),
    conversationId,
    createdBy: userId,
    options: { sandbox: "auto", webSearch: "auto" },
    runId: newId("run") as RunId,
    target: { id: agentId, type: "agent" },
    userMessageId: newId("message") as MessageId,
  });

  const chatOf = async (userId: UserId): Promise<ConversationId> => {
    const chat = await createConversation(testDb.db, {
      context: personalContext(userId),
      ownerId: userId,
      title: "Orchard",
    });
    return chat.id;
  };

  const search = async (tools: ToolSet | undefined, query: string) =>
    (await tools?.[FILE_SEARCH_TOOL]?.execute?.(
      { limit: 10, query },
      { context: {}, messages: [], toolCallId: "call-9" }
    )) as FileSearchToolOutput | undefined;

  const state = { facts: {}, history: [], input: "What about persimmons?" };
  const unusedModel = new MockLanguageModelV4();

  it("searches the knowledge plus the chat's own attachments, nothing else", async () => {
    const owner = await someone();
    const bob = await someone();
    const { upload } = await fileStore();
    const pdf = await upload(owner, await handbook(), {
      purpose: "knowledge",
    });
    const agentId = await publishedAgent(owner, [pdf]);
    await grantUse(owner, agentId, bob);
    const bobsChat = await chatOf(bob);
    const ownersChat = await chatOf(owner);
    const notes = new File(["Persimmons need frost to sweeten."], "notes.txt", {
      type: "text/plain",
    });
    const attached = await upload(bob, notes, {
      conversationId: bobsChat,
      purpose: "attachment",
    });
    // Someone else's attachment, in a chat bob can't read.
    const hidden = await upload(
      owner,
      new File(["Persimmons are secretly plums."], "private.txt", {
        type: "text/plain",
      }),
      { conversationId: ownersChat, purpose: "attachment" }
    );

    const turn = expectOk(
      await createTurnResolver(resolverDeps(unusedModel))(
        runFor(bob, agentId, bobsChat),
        { state }
      )
    );
    expect(turn.toolApproval?.[FILE_SEARCH_TOOL]).toBe("not-applicable");
    const output = await search(turn.tools, "persimmons");
    const found = output?.status === "ok" ? output.hits : [];
    expect(new Set(found.map((hit) => hit.fileId))).toEqual(
      new Set([pdf, attached])
    );
    expect(found.map((hit) => hit.fileId)).not.toContain(hidden);
  });

  it("isn't offered to an agent without knowledge, or without an embedder", async () => {
    const owner = await someone();
    const { upload } = await fileStore();
    const pdf = await upload(owner, await handbook(), {
      purpose: "knowledge",
    });
    const chat = await chatOf(owner);
    const bare = await publishedAgent(owner, []);
    const knowing = await publishedAgent(owner, [pdf]);

    const withEmbedder = createTurnResolver(resolverDeps(unusedModel));
    const plain = expectOk(
      await withEmbedder(runFor(owner, bare, chat), { state })
    );
    expect(Object.keys(plain.tools ?? {})).toEqual([]);

    const noEmbedder = createTurnResolver(resolverDeps(unusedModel, {}));
    const degraded = expectOk(
      await noEmbedder(runFor(owner, knowing, chat), { state })
    );
    expect(Object.keys(degraded.tools ?? {})).toEqual([]);
  });

  it("is dropped when the retrieval gate says the turn doesn't need it", async () => {
    const owner = await someone();
    const { upload } = await fileStore();
    const pdf = await upload(owner, await handbook(), {
      purpose: "knowledge",
    });
    const agentId = await publishedAgent(owner, [pdf]);
    const chat = await chatOf(owner);
    const gatedBy = (needsFiles: boolean) =>
      createFakeDecider({
        answer: (question) => ({
          id: question.id,
          probability: 0.9,
          type: "boolean",
          value: needsFiles,
        }),
      });

    const skip = gatedBy(false);
    const skipped = expectOk(
      await createTurnResolver(
        resolverDeps(unusedModel, {
          knowledge: { embedder },
          retrieval: { decider: skip, threshold: 0.5 },
        })
      )(runFor(owner, agentId, chat), { state })
    );
    expect(skipped.tools?.[FILE_SEARCH_TOOL]).toBeUndefined();
    expect(skipped.toolApproval?.[FILE_SEARCH_TOOL]).toBeUndefined();
    expect(skip.calls).toHaveLength(1);
    expect(skip.calls[0]?.options.purpose).toBe("retrieval-gate");
    expect(skip.calls[0]?.state.input).toBe("What about persimmons?");

    const keep = gatedBy(true);
    const kept = expectOk(
      await createTurnResolver(
        resolverDeps(unusedModel, {
          knowledge: { embedder },
          retrieval: { decider: keep, threshold: 0.5 },
        })
      )(runFor(owner, agentId, chat), { state })
    );
    expect(kept.tools?.[FILE_SEARCH_TOOL]).toBeDefined();
  });
});

describe("withCitations", () => {
  const fileId = newId("file") as FileId;
  const source = {
    id: "call-1-1",
    source: { fileId, kind: "file" as const, page: 2 },
    type: "source" as const,
  };
  const result = {
    output: {
      status: "success" as const,
      value: { hits: [], sources: [source], status: "ok" },
    },
    toolCallId: "call-1",
    toolName: FILE_SEARCH_TOOL,
    type: "tool-result" as const,
  };

  it("stores a retrieval result's sources after it, once", () => {
    expect(withCitations([result])).toEqual([result, source]);
    // A resumed answer comes back with the citation already in place.
    expect(withCitations([result, source])).toEqual([result, source]);
  });

  it("leaves other tools' results alone", () => {
    const other = {
      ...result,
      output: { status: "success" as const, value: { answer: 42 } },
      toolName: "calculator",
    };
    const failed = {
      ...result,
      output: { message: "boom", status: "error" as const },
    };
    expect(withCitations([other, failed])).toEqual([other, failed]);
  });
});
