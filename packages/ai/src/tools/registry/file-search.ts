import type { FileSearchHit } from "@workspace/contract/schemas/files";

import { FILE_SEARCH_TOOL } from "../../decider/retrieval-gate";
import {
  type FileSearchDeps,
  type FileSearchToolOutput,
  fileSearchToolInputSchema,
  fileSearchToolOutputSchema,
  searchFiles,
} from "../../rag/file-search";
import { type SourcePart, sourceId } from "../../rag/sources";
import { defineTool, type ToolContext } from "./define";

// The `file_search` tool (PLAN.md §8 RAG step 5): semantic search over the
// files this turn may read (the conversation's attachments and the agent's
// knowledge files), answered from pgvector. Which files those are is the
// caller's grant check, a port, so the model can't widen its own reach by
// naming a file id.
//
// The search itself and the schemas stay in `rag/file-search.ts`, which the
// `files.search` handler shares. That module's `createFileSearchTool` is
// the old factory, kept as it was for one release; `registry.test.ts` holds
// the two to the same description, schemas and results until it goes.

/** The embedder, the grant check and the chunk query, as `searchFiles` takes them. */
export type FileSearchPorts = FileSearchDeps;

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

export const fileSearch = defineTool({
  // Reading files the caller may already read changes nothing.
  approval: "auto",
  capability: "knowledge",
  description:
    "Search the user's uploaded files and this agent's knowledge files for passages relevant to the query. Cite passages by their [number].",
  execute: async (
    input,
    {
      ports,
      signal,
      toolCallId,
    }: ToolContext<{ readonly ports: FileSearchPorts }>
  ): Promise<FileSearchToolOutput> => {
    const fileIds = await ports.searchableFileIds();
    if (fileIds.length === 0) {
      return {
        message: "There are no searchable files in this conversation.",
        status: "unavailable",
      };
    }
    const result = await searchFiles(
      ports,
      { fileIds, limit: input.limit, query: input.query },
      signal
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
  input: fileSearchToolInputSchema,
  modelText: toModelText,
  name: FILE_SEARCH_TOOL,
  output: fileSearchToolOutputSchema,
});
