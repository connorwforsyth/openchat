import { readFile } from "node:fs/promises";

import type { FileId } from "@workspace/contract/schemas/common";
import { newId } from "@workspace/shared/ids";
import { err, ok } from "@workspace/shared/result";
import { describe, expect, it } from "vitest";

import { createHashEmbedder } from "../ports/embedder.memory";
import {
  type IngestDeps,
  type IngestionFile,
  ingestFile,
  ingestFileJob,
  reindexEmbeddingsJob,
} from "./ingest";
import { createMemoryIngestionStore } from "./ingestion-store.memory";

const pdf = async () =>
  new Uint8Array(
    await readFile(new URL("./__fixtures__/two-pages.pdf", import.meta.url))
  );

const fileOf = (values: Partial<IngestionFile> = {}): IngestionFile => ({
  id: newId("file"),
  mediaType: "text/plain",
  name: "notes.txt",
  purpose: "knowledge",
  storageKey: `uploads/${newId("x")}`,
  ...values,
});

const setup = (blobs: Record<string, Uint8Array>, files: IngestionFile[]) => {
  const store = createMemoryIngestionStore(files);
  const deps: IngestDeps = {
    embedder: createHashEmbedder({ dimensions: 16, maxBatchSize: 2 }),
    readBlob: (key) =>
      Promise.resolve(
        blobs[key] ? ok(blobs[key]) : err({ message: "no such object" })
      ),
    store,
  };
  return { deps, store };
};

const { signal } = new AbortController();

describe("ingestFile", () => {
  it("parses, chunks and embeds a PDF, keeping page numbers", async () => {
    const file = fileOf({ mediaType: "application/pdf", name: "fruit.pdf" });
    const { deps, store } = setup({ [file.storageKey]: await pdf() }, [file]);
    expect(await ingestFile(deps, file.id)).toEqual({
      ok: true,
      value: {
        chunkCount: 2,
        embeddingModel: "test:hash-embedding",
        state: "ready",
      },
    });
    expect(store.transitions(file.id)).toEqual([
      "uploaded",
      "processing",
      "ready",
    ]);
    const { chunks } = store.state(file.id) ?? { chunks: [] };
    expect(chunks.map((chunk) => [chunk.page, chunk.text])).toEqual([
      [1, "Kumquats ripen in winter."],
      [2, "Page two mentions persimmons."],
    ]);
    expect(chunks.every((chunk) => chunk.embedding?.length === 16)).toBe(true);
  });

  it("stores unembedded chunks when no embedding model is configured", async () => {
    const file = fileOf();
    const { deps, store } = setup(
      { [file.storageKey]: new TextEncoder().encode("Hello there.") },
      [file]
    );
    expect(await ingestFile({ ...deps, embedder: null }, file.id)).toEqual({
      ok: true,
      value: { chunkCount: 1, embeddingModel: null, state: "ready" },
    });
    expect(store.state(file.id)?.chunks[0]?.embedding).toBeNull();
  });

  it("marks images and skill files ready without indexing or reading them", async () => {
    const image = fileOf({ mediaType: "image/png", name: "cat.png" });
    const skill = fileOf({ name: "SKILL.md", purpose: "skill" });
    const { deps, store } = setup({}, [image, skill]);
    for (const file of [image, skill]) {
      // biome-ignore lint/performance/noAwaitInLoops: two files, in turn.
      expect(await ingestFile(deps, file.id)).toEqual({
        ok: true,
        value: { chunkCount: 0, embeddingModel: null, state: "ready" },
      });
      expect(store.transitions(file.id)).toEqual(["uploaded", "ready"]);
    }
  });

  it("fails a broken file for good, without asking for a retry", async () => {
    const file = fileOf({ mediaType: "application/pdf", name: "broken.pdf" });
    const { deps, store } = setup(
      { [file.storageKey]: new TextEncoder().encode("not a pdf") },
      [file]
    );
    const outcome = await ingestFile(deps, file.id);
    expect(outcome).toMatchObject({ ok: true, value: { state: "failed" } });
    expect(store.state(file.id)).toMatchObject({
      message: expect.stringContaining("PDF couldn't be read"),
      state: "failed",
    });
  });

  it("asks for a retry when storage or the embedder is down", async () => {
    const file = fileOf();
    const { deps, store } = setup({}, [file]);
    expect(await ingestFile(deps, file.id)).toEqual({
      error: "storage: no such object",
      ok: false,
    });
    expect(store.state(file.id)?.state).toBe("failed");

    const text = fileOf();
    const withText = setup(
      { [text.storageKey]: new TextEncoder().encode("Some text.") },
      [text]
    );
    const rateLimited: IngestDeps = {
      ...withText.deps,
      embedder: {
        ...createHashEmbedder(),
        embed: () =>
          Promise.resolve(
            err({ retryAfterSeconds: 3, type: "rate_limited" as const })
          ),
      },
    };
    expect(await ingestFile(rateLimited, text.id)).toEqual({
      error: "embeddings: rate_limited",
      ok: false,
    });
    expect(withText.store.state(text.id)).toMatchObject({
      message: expect.stringContaining("retried"),
      state: "failed",
    });
    // The retry succeeds and clears the message.
    expect(await ingestFile(withText.deps, text.id)).toMatchObject({
      value: { state: "ready" },
    });
    expect(withText.store.state(text.id)?.message).toBeNull();
  });

  it("succeeds quietly when the file was deleted first", async () => {
    const { deps } = setup({}, []);
    const job = ingestFileJob(deps);
    expect(await job({ data: { fileId: newId("file") } }, signal)).toEqual({
      ok: true,
      value: { state: "gone" },
    });
  });
});

describe("reindexEmbeddingsJob", () => {
  it("queues every file not embedded with the new model, page by page", async () => {
    const files = Array.from({ length: 5 }, () => fileOf());
    const { deps, store } = setup(
      Object.fromEntries(
        files.map((file) => [file.storageKey, new TextEncoder().encode("hi")])
      ),
      files
    );
    for (const file of files.slice(0, 4)) {
      // biome-ignore lint/performance/noAwaitInLoops: set up in turn.
      await ingestFile(deps, file.id);
    }
    const queued: FileId[] = [];
    const job = reindexEmbeddingsJob({
      enqueueIngest: (fileId) => {
        queued.push(fileId);
        return Promise.resolve(ok(fileId));
      },
      pageSize: 2,
      store,
    });
    expect(await job({ data: { model: "test:other" } }, signal)).toEqual({
      ok: true,
      value: { enqueued: 4, model: "test:other" },
    });
    expect(new Set(queued)).toEqual(
      new Set(files.slice(0, 4).map((file) => file.id))
    );
    expect(
      await job({ data: { model: "test:hash-embedding" } }, signal)
    ).toMatchObject({ value: { enqueued: 0 } });
  });
});
