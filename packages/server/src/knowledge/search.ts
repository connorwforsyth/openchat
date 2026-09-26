import type {
  SearchHit,
  searchConversationsInputSchema,
} from "@workspace/contract/schemas/search";
import type { Db } from "@workspace/db/client";
import { searchConversations } from "@workspace/db/queries/conversations";
import type { Page } from "@workspace/db/queries/page";
import { type AsyncResult, err, ok } from "@workspace/shared/result";
import type { z } from "zod";

import { invalid, type KnowledgeError } from "./errors";
import type { KnowledgeContext } from "./files";

// The handler for the contract's `search` group: full-text search over the
// titles and messages of chats the caller can read (Postgres tsvector,
// `searchConversations`), with highlight offsets rather than HTML.

type SearchInput = z.output<typeof searchConversationsInputSchema>;

export const createSearchHandlers = ({ db }: { readonly db: Db }) => ({
  conversations: async (
    { viewer }: KnowledgeContext,
    input: SearchInput
  ): AsyncResult<Page<SearchHit>, KnowledgeError> => {
    const page = await searchConversations(db, viewer, input);
    return page.ok
      ? ok(page.value)
      : err(invalid(["cursor"], "The cursor isn't valid."));
  },
});

export type SearchHandlers = ReturnType<typeof createSearchHandlers>;
