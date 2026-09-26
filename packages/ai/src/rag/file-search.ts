import type { FileId } from "@workspace/contract/schemas/common";
import {
  type FileSearchHit,
  fileSearchHitSchema,
} from "@workspace/contract/schemas/files";
import { sourcePartSchema } from "@workspace/contract/schemas/message-parts";
import type { ModelRef } from "@workspace/contract/schemas/models";
import { type Tool, tool } from "ai";
import { z } from "zod";

import type { Embedder } from "../ports/embedder";
import { type SourcePart, sourceId } from "./sources";

// The `file_search` tool (PLAN.md §8 RAG step 5): semantic search over the
// files this turn may read (the conversation's attachments and the agent's
// knowledge files), answered from pgvector. Which files those are is the
// caller's grant check, injected, so the model can't widen its own reach by
// naming a file id. The retrieval gate (D15) decides per turn whether the
// tool is offered at all; its name is the one the gate knows.

export const fileSearchToolInputSchema = z.object({
  limit: z
    .int()
    .min(1)
    .max(10)
    .default(5)
    .describe("How many passages to return."),
  query: z
    .string()
    .trim()
    .min(1)
    .max(2000)
    .describe(
      "What to look for, phrased like the passage you hope to find rather than as a question."
    ),
});

export const fileSearchToolOutputSchema = z.discriminatedUnion("status", [
  z.object({
    hits: z.array(fileSearchHitSchema.extend({ sourceId: z.string() })),
    sources: z.array(sourcePartSchema),
    status: z.literal("ok"),
  }),
  /** Nothing to search, or the embedding provider is down; the run carries on. */
  z.object({ message: z.string(), status: z.literal("unavailable") }),
]);
export type FileSearchToolOutput = z.infer<typeof fileSearchToolOutputSchema>;

export interface ChunkQuery {
  readonly embedding: readonly number[];
  readonly fileIds: readonly FileId[];
  readonly limit: number;
  readonly model: ModelRef;
}

export interface FileSearchDeps {
  readonly embedder: Embedder;
  /** Drops weak matches, so "nothing relevant" reads as nothing. */
  readonly minScore?: number;
  /**
   * The grant check: the indexed files this turn may search. Anything the
   * caller can't read must be absent; an empty list means nothing to search.
   */
  readonly searchableFileIds: () => Promise<readonly FileId[]>;
  /** Nearest chunks among `fileIds` (`searchChunks` in `@workspace/db`). */
  readonly searchChunks: (
    query: ChunkQuery
  ) => Promise<readonly FileSearchHit[]>;
}

const citation = (id: string, hit: FileSearchHit): SourcePart => ({
  id,
  source: {
    chunkId: hit.chunkId,
    fileId: hit.fileId,
    filename: hit.filename,
    kind: "file",
    ...(hit.page === null ? {} : { page: hit.page }),
  },
  type: "source",
});

/** Runs one search: the shared core of the tool and the `files.search` handler. */
export const searchFiles = async (
  deps: Omit<FileSearchDeps, "searchableFileIds">,
  input: {
    readonly fileIds: readonly FileId[];
    readonly limit: number;
    readonly query: string;
  },
  signal?: AbortSignal
): Promise<
  | { readonly hits: readonly FileSearchHit[]; readonly ok: true }
  | { readonly message: string; readonly ok: false }
> => {
  if (input.fileIds.length === 0) {
    return { hits: [], ok: true };
  }
  const embedded = await deps.embedder.embed([input.query], { signal });
  const embedding = embedded.ok ? embedded.value.embeddings[0] : undefined;
  if (!embedding) {
    return {
      message:
        "File search is unavailable right now: the embedding provider didn't answer.",
      ok: false,
    };
  }
  const hits = await deps.searchChunks({
    embedding,
    fileIds: input.fileIds,
    limit: input.limit,
    model: deps.embedder.model,
  });
  const minScore = deps.minScore ?? 0;
  return { hits: hits.filter((hit) => hit.score >= minScore), ok: true };
};

/** The model's view: numbered passages it can cite, without ids it can't use. */
const toModelText = (output: FileSearchToolOutput): string => {
  if (output.status === "unavailable") {
    return output.message;
  }
  if (output.hits.length === 0) {
    return "No passages in the available files match that query.";
  }
  return output.hits
    .map((hit, index) => {
      const where = hit.page === null ? "" : `, page ${hit.page}`;
      return `[${index + 1}] ${hit.filename}${where}\n${hit.text}`;
    })
    .join("\n\n");
};

export const createFileSearchTool = (deps: FileSearchDeps): Tool =>
  tool({
    description:
      "Search the user's uploaded files and this agent's knowledge files for passages relevant to the query. Cite passages by their [number].",
    execute: async (
      input,
      { abortSignal, toolCallId }
    ): Promise<FileSearchToolOutput> => {
      const fileIds = await deps.searchableFileIds();
      if (fileIds.length === 0) {
        return {
          message: "There are no searchable files in this conversation.",
          status: "unavailable",
        };
      }
      const result = await searchFiles(
        deps,
        { fileIds, limit: input.limit, query: input.query },
        abortSignal
      );
      if (!result.ok) {
        return { message: result.message, status: "unavailable" };
      }
      const hits = result.hits.map((hit, index) => ({
        ...hit,
        sourceId: sourceId(toolCallId, index + 1),
      }));
      return {
        hits,
        sources: hits.map((hit) => citation(hit.sourceId, hit)),
        status: "ok",
      };
    },
    inputSchema: fileSearchToolInputSchema,
    outputSchema: fileSearchToolOutputSchema,
    toModelOutput: ({ output }) => ({
      type: "text",
      value: toModelText(output),
    }),
  });
