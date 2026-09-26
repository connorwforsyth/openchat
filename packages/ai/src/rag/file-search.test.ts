import type { FileId } from "@workspace/contract/schemas/common";
import type { FileSearchHit } from "@workspace/contract/schemas/files";
import { newId } from "@workspace/shared/ids";
import { err } from "@workspace/shared/result";
import type { Tool } from "ai";
import { describe, expect, it } from "vitest";

import { FILE_SEARCH_TOOL, gateRetrieval } from "../decider/retrieval-gate";
import { createFakeDecider } from "../ports/decider.memory";
import {
  cosineSimilarity,
  createHashEmbedder,
  hashEmbedding,
} from "../ports/embedder.memory";
import {
  type ChunkQuery,
  createFileSearchTool,
  type FileSearchToolOutput,
} from "./file-search";
import { toolSources } from "./sources";

const embedder = createHashEmbedder({ dimensions: 64 });
const mine = newId("file");
const theirs = newId("file");

const corpus = [
  { fileId: mine, page: 3, text: "Kumquats ripen in the winter months." },
  { fileId: mine, page: null, text: "Invoices are due within thirty days." },
  { fileId: theirs, page: 1, text: "Kumquats ripen in winter, secretly." },
].map((chunk) => ({
  ...chunk,
  chunkId: newId("fileChunk"),
  embedding: hashEmbedding(chunk.text, 64),
  filename: chunk.fileId === mine ? "fruit.pdf" : "private.pdf",
}));

/** A stand-in for `searchChunks`: cosine ranking within the allowed files. */
const searchChunks = (query: ChunkQuery): Promise<FileSearchHit[]> =>
  Promise.resolve(
    corpus
      .filter((chunk) => query.fileIds.includes(chunk.fileId))
      .map(({ chunkId, embedding, fileId, filename, page, text }) => ({
        chunkId,
        fileId,
        filename,
        page,
        score: Math.max(0, cosineSimilarity(embedding, query.embedding)),
        text,
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, query.limit)
  );

const run = async (
  searchTool: Tool,
  query: string
): Promise<FileSearchToolOutput> =>
  (await searchTool.execute?.(
    { limit: 2, query },
    { context: {}, messages: [], toolCallId: "call_1" }
  )) as FileSearchToolOutput;

describe("file_search", () => {
  it("returns the closest chunks from files the turn may read, with citations", async () => {
    const searchTool = createFileSearchTool({
      embedder,
      minScore: 0.2,
      searchableFileIds: () => Promise.resolve([mine]),
      searchChunks,
    });
    const output = await run(searchTool, "when do kumquats ripen");
    expect(output.status).toBe("ok");
    if (output.status !== "ok") {
      return;
    }
    expect(output.hits.map((hit) => hit.text)).toEqual([
      "Kumquats ripen in the winter months.",
    ]);
    expect(toolSources(output)).toEqual([
      {
        id: "call_1-1",
        source: {
          chunkId: corpus[0]?.chunkId,
          fileId: mine,
          filename: "fruit.pdf",
          kind: "file",
          page: 3,
        },
        type: "source",
      },
    ]);
    const modelView = await searchTool.toModelOutput?.({
      input: { limit: 2, query: "kumquats" },
      output,
      toolCallId: "call_1",
    });
    expect(modelView).toEqual({
      type: "text",
      value: "[1] fruit.pdf, page 3\nKumquats ripen in the winter months.",
    });
  });

  it("finds nothing without searchable files, and says so", async () => {
    const searchTool = createFileSearchTool({
      embedder,
      searchableFileIds: () => Promise.resolve([] as FileId[]),
      searchChunks,
    });
    expect(await run(searchTool, "kumquats")).toEqual({
      message: "There are no searchable files in this conversation.",
      status: "unavailable",
    });
  });

  it("reports an embedding outage as a result, not a failure", async () => {
    const searchTool = createFileSearchTool({
      embedder: {
        ...embedder,
        embed: () =>
          Promise.resolve(
            err({ message: "down", type: "unavailable" as const })
          ),
      },
      searchableFileIds: () => Promise.resolve([mine]),
      searchChunks,
    });
    expect(await run(searchTool, "kumquats")).toMatchObject({
      status: "unavailable",
    });
  });

  it("is dropped by the retrieval gate when the Decider says the turn doesn't need it", async () => {
    const gate = await gateRetrieval({
      activeTools: [FILE_SEARCH_TOOL, "other"],
      decider: createFakeDecider({
        answer: (question) => ({
          id: question.id,
          probability: 0.1,
          type: "boolean",
          value: true,
        }),
      }),
      memory: false,
      options: { webSearch: "auto" },
      state: { facts: {}, history: [], input: "Hi there!" },
      threshold: 0.5,
    });
    expect(gate.activeTools).toEqual(["other"]);
  });
});
