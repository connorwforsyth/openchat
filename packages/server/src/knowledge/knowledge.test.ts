import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createAiSdkEmbedder } from "@workspace/ai/rag/embedder";
import type { FileSearchToolOutput } from "@workspace/ai/rag/file-search";
import {
  INGEST_FILE_JOB,
  REINDEX_EMBEDDINGS_JOB,
} from "@workspace/ai/rag/ingest";
import { createHashEmbeddingModel } from "@workspace/ai/rag/mock-embedding-model";
import { toolSources } from "@workspace/ai/rag/sources";
import { type AppConfigInput, appConfigSchema } from "@workspace/config/schema";
import type {
  ConversationId,
  UserId,
} from "@workspace/contract/schemas/common";
import { fileSchema } from "@workspace/contract/schemas/files";
import { searchHitSchema } from "@workspace/contract/schemas/search";
import {
  createConversation,
  type Viewer,
} from "@workspace/db/queries/conversations";
import { getFile } from "@workspace/db/queries/files";
import { insertMessage } from "@workspace/db/queries/messages";
import { loadPrincipals } from "@workspace/db/queries/teams";
import {
  createTestDb,
  expectOk,
  seedOrg,
  seedUser,
  type TestDb,
} from "@workspace/db/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createMemoryJobQueue } from "../ports/job-queue.memory";
import { createLocalStorage } from "../storage/local";
import { fileSearchToolFor } from "./file-search-tool";
import { createFileHandlers } from "./files";
import { createKnowledgeJobs, type KnowledgeJobs } from "./ingestion";
import { createSearchHandlers } from "./search";

// End to end on PGlite + pgvector: an uploaded PDF is stored, ingested by
// the job, embedded (by a hash model behind the real AI SDK interface) and
// found by `files.search` and `file_search`; a chat message is found by
// full-text search; strangers see none of it.

let testDb: TestDb;
let root: string;
beforeAll(async () => {
  testDb = await createTestDb();
  root = await mkdtemp(join(tmpdir(), "knowledge-test-"));
}, 60_000);
afterAll(async () => {
  await testDb.close();
  await rm(root, { force: true, recursive: true });
});

const PDF = "application/pdf";
const pdfFixture = () =>
  readFile(
    new URL("../../../ai/src/rag/__fixtures__/two-pages.pdf", import.meta.url)
  );

const viewerOf = async (userId: UserId): Promise<Viewer> => ({
  principals: await loadPrincipals(testDb.db, userId),
  userId,
});

const embedderFor = (ref: string) =>
  createAiSdkEmbedder({
    // 384 has a partial HNSW index, so the indexed query path runs too.
    dimensions: 384,
    model: createHashEmbeddingModel({ dimensions: 384 }),
    ref,
  });

const setup = async (configInput: AppConfigInput = {}) => {
  const { db } = testDb;
  const config = appConfigSchema.parse(configInput);
  const queue = createMemoryJobQueue<KnowledgeJobs>();
  const storage = createLocalStorage({
    baseUrl: "http://localhost:3000/api/storage",
    root,
    signingSecret: "test-signing-secret",
  });
  const embedder = embedderFor("test:hash-a");
  const jobs = createKnowledgeJobs({ db, embedder, queue, storage });
  await queue.work(INGEST_FILE_JOB, jobs[INGEST_FILE_JOB]);
  await queue.work(REINDEX_EMBEDDINGS_JOB, jobs[REINDEX_EMBEDDINGS_JOB]);
  const files = createFileHandlers({
    config,
    db,
    embedder,
    queue,
    storage: { driver: "local", storage },
  });

  const owner = await seedUser(db);
  const stranger = await seedUser(db);
  const personal = await seedOrg(db, owner.id, { isPersonal: true });
  const chat = await createConversation(db, {
    context: { id: personal.id, type: "personal" },
    ownerId: owner.id,
    title: "Winter fruit",
  });
  return {
    chat,
    db,
    embedder,
    files,
    me: { viewer: await viewerOf(owner.id) },
    queue,
    storage,
    them: { viewer: await viewerOf(stranger.id) },
  };
};

const upload = async (
  files: ReturnType<typeof createFileHandlers>,
  context: { viewer: Viewer },
  file: File,
  conversationId?: ConversationId
) => files.upload(context, { conversationId, file, purpose: "knowledge" });

describe("an uploaded PDF becomes searchable", () => {
  it("stores, ingests, embeds and finds it, for its owner only", async () => {
    const { chat, db, embedder, files, me, queue, them } = await setup();
    const uploaded = expectOk(
      await upload(
        files,
        me,
        new File([await pdfFixture()], "fruit.pdf", { type: PDF }),
        chat.id
      )
    );
    expect(fileSchema.parse(uploaded).status).toEqual({ state: "uploaded" });
    expect(queue.jobs().map((job) => job.name)).toEqual([INGEST_FILE_JOB]);

    await queue.drain();
    expect(queue.jobs()[0]?.state).toBe("completed");
    const ready = expectOk(await files.get(me, { id: uploaded.id }));
    expect(ready.status).toEqual({
      chunkCount: 2,
      embeddingModel: "test:hash-a",
      state: "ready",
    });

    const hits = expectOk(
      await files.search(me, { limit: 1, query: "kumquats ripen in winter" })
    );
    expect(hits).toEqual([
      expect.objectContaining({
        fileId: uploaded.id,
        filename: "fruit.pdf",
        page: 1,
        text: "Kumquats ripen in winter.",
      }),
    ]);
    expect(
      expectOk(await files.search(them, { limit: 5, query: "kumquats" }))
    ).toEqual([]);
    expect(await files.get(them, { id: uploaded.id })).toEqual({
      error: { code: "NOT_FOUND" },
      ok: false,
    });

    // The same file through the chat's `file_search` tool, with citations.
    const tool = fileSearchToolFor({
      conversationId: chat.id,
      db,
      embedder,
      viewer: me.viewer,
    });
    const output = (await tool.execute?.(
      { limit: 1, query: "persimmons" },
      { context: {}, messages: [], toolCallId: "call_1" }
    )) as FileSearchToolOutput;
    expect(output.status === "ok" && output.hits[0]?.page).toBe(2);
    expect(toolSources(output)).toEqual([
      expect.objectContaining({
        source: expect.objectContaining({ fileId: uploaded.id, page: 2 }),
      }),
    ]);

    // A signed URL downloads it; deleting removes row, chunks and bytes.
    const url = expectOk(await files.getUrl(me, { id: uploaded.id }));
    expect(url.url.startsWith("http://localhost:3000/api/storage/files/")).toBe(
      true
    );
    expect(await files.delete(them, { id: uploaded.id })).toMatchObject({
      error: { code: "NOT_FOUND" },
    });
    const row = expectOk(await getFile(db, uploaded.id));
    expectOk(await files.delete(me, { id: uploaded.id }));
    expect(await getFile(db, uploaded.id)).toMatchObject({ ok: false });
    expect(await files.getUrl(me, { id: uploaded.id })).toMatchObject({
      error: { code: "NOT_FOUND" },
    });
    expect(row.storageKey.startsWith(`files/${me.viewer.userId}/`)).toBe(true);
  });

  it("re-indexes when the embedding model changes", async () => {
    const { db, files, me, queue, storage } = await setup();
    const uploaded = expectOk(
      await upload(
        files,
        me,
        new File(["Medlars are eaten bletted."], "notes.md", {
          type: "text/markdown",
        })
      )
    );
    await queue.drain();

    // Next boot: a new model, so the queue gets a re-index job.
    const nextQueue = createMemoryJobQueue<KnowledgeJobs>();
    const nextJobs = createKnowledgeJobs({
      db,
      embedder: embedderFor("test:hash-b"),
      queue: nextQueue,
      storage,
    });
    await nextQueue.work(INGEST_FILE_JOB, nextJobs[INGEST_FILE_JOB]);
    await nextQueue.work(
      REINDEX_EMBEDDINGS_JOB,
      nextJobs[REINDEX_EMBEDDINGS_JOB]
    );
    await nextQueue.enqueue(REINDEX_EMBEDDINGS_JOB, { model: "test:hash-b" });
    await nextQueue.drain();
    expect(
      nextQueue.jobs().map((job) => [job.name, job.state, job.data])
    ).toContainEqual([INGEST_FILE_JOB, "completed", { fileId: uploaded.id }]);
    expect(expectOk(await getFile(db, uploaded.id)).embeddingModel).toBe(
      "test:hash-b"
    );
  });
});

describe("uploads", () => {
  it("validates type, contents and size, and honours the feature flag", async () => {
    const { chat, files, me, them } = await setup({
      limits: { uploadMaxMb: 1 },
    });
    const code = async (file: File) => {
      const result = await upload(files, me, file);
      return result.ok ? "ok" : result.error.code;
    };
    expect(
      await code(new File(["not a png"], "fake.png", { type: "image/png" }))
    ).toBe("VALIDATION");
    expect(
      await code(new File([new Uint8Array(2 * 1024 * 1024)], "big.txt"))
    ).toBe("VALIDATION");
    expect(
      await code(
        new File([new Uint8Array([1, 2])], "app.exe", {
          type: "application/x-msdownload",
        })
      )
    ).toBe("VALIDATION");
    // A picture attaches but isn't indexed: ready at once, no job.
    const png = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0,
    ]);
    const image = expectOk(
      await upload(files, me, new File([png], "dot.png", { type: "image/png" }))
    );
    expect(image.status).toEqual({
      chunkCount: 0,
      embeddingModel: null,
      state: "ready",
    });
    // Someone who can't post in the chat can't attach to it.
    expect(
      await upload(files, them, new File(["hi"], "a.txt"), chat.id)
    ).toMatchObject({ error: { code: "NOT_FOUND" } });

    const off = await setup({ features: { fileUploads: false } });
    expect(
      await upload(off.files, off.me, new File(["hi"], "a.txt"))
    ).toMatchObject({
      error: { code: "FEATURE_DISABLED", data: { feature: "fileUploads" } },
    });
  });

  it("lists a chat's files for anyone who can read it", async () => {
    const { chat, files, me, them } = await setup();
    const attached = expectOk(
      await upload(files, me, new File(["hello"], "a.txt"), chat.id)
    );
    const page = expectOk(
      await files.list(me, { conversationId: chat.id, limit: 10 })
    );
    expect(page.items.map((item) => item.id)).toEqual([attached.id]);
    expect(
      await files.list(them, { conversationId: chat.id, limit: 10 })
    ).toMatchObject({ error: { code: "NOT_FOUND" } });
  });
});

describe("chat search", () => {
  it("finds a message by its words, with highlights, only for readers", async () => {
    const { chat, db, me, them } = await setup();
    expectOk(
      await insertMessage(db, {
        authorId: me.viewer.userId,
        conversationId: chat.id,
        parentId: null,
        parts: [
          { text: "When is the quince harvest this year?", type: "text" },
        ],
        role: "user",
      })
    );
    const search = createSearchHandlers({ db });
    const page = expectOk(
      await search.conversations(me, { limit: 10, query: "quince" })
    );
    const hit = page.items.find((item) => item.messageId !== null);
    expect(hit && searchHitSchema.parse(hit)).toEqual(hit);
    expect(hit?.conversationId).toBe(chat.id);
    const [span] = hit?.highlights ?? [];
    expect(span && hit?.snippet.slice(span.start, span.end)).toBe("quince");
    expect(
      expectOk(await search.conversations(them, { limit: 10, query: "quince" }))
        .items
    ).toEqual([]);
    expect(
      await search.conversations(me, {
        cursor: Buffer.from("not-a-number").toString("base64url"),
        limit: 10,
        query: "quince",
      })
    ).toMatchObject({ error: { code: "VALIDATION" } });
  });
});
