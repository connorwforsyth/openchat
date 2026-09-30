import type { Embedder } from "@workspace/ai/ports/embedder";
import { fileSearch } from "@workspace/ai/tools/registry/file-search";
import { toAiSdkTool } from "@workspace/ai/tools/registry/to-ai-sdk";
import type {
  ConversationId,
  FileId,
} from "@workspace/contract/schemas/common";
import type { Db } from "@workspace/db/client";
import type { Viewer } from "@workspace/db/queries/conversations";
import {
  listReadableIndexedFileIds,
  searchChunks,
} from "@workspace/db/queries/files";
import type { Tool } from "ai";

// `file_search` for one turn, wired to the database. It searches the chat's
// attachments the viewer can read, plus the agent's knowledge files, which
// the caller has already cleared through the agent's grant (the run only
// gets an agent the user may `use`). Files not embedded with the current
// model simply have no matching vectors, so they're never returned.
//
// The tool itself is defined in the registry (`@workspace/ai`'s
// `tools/registry/file-search.ts`, 080); this binds it to the database and
// hands back the AI SDK tool, as it always did.

/** Most attachments one turn searches across. */
const ATTACHMENT_LIMIT = 500;

export interface FileSearchToolInput {
  /** The agent version's knowledge files, already grant-checked. */
  readonly agentFileIds?: readonly FileId[];
  readonly conversationId: ConversationId | null;
  readonly db: Db;
  readonly embedder: Embedder;
  readonly minScore?: number;
  readonly viewer: Viewer;
}

export const fileSearchToolFor = ({
  agentFileIds = [],
  conversationId,
  db,
  embedder,
  minScore = 0.2,
  viewer,
}: FileSearchToolInput): Tool =>
  toAiSdkTool(fileSearch, {
    actor: { userId: viewer.userId },
    conversation: { id: conversationId },
    ports: {
      embedder,
      minScore,
      searchableFileIds: async () => {
        const attached = conversationId
          ? await listReadableIndexedFileIds(db, viewer, {
              conversationId,
              limit: ATTACHMENT_LIMIT,
            })
          : [];
        return [...new Set([...attached, ...agentFileIds])];
      },
      searchChunks: (query) => searchChunks(db, query),
    },
  });
