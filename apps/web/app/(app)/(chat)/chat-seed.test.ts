import { QueryClient } from "@tanstack/react-query";
import { createApiClient, createQueryUtils } from "@workspace/client/api";
import {
  branchPath,
  conversation,
  runAwaitingApproval,
} from "@workspace/contract/fixtures";
import type { ConversationId } from "@workspace/contract/schemas/common";
import { describe, expect, it, vi } from "vitest";

import { fakeApi } from "../_shared/test-harness";
import { type ChatSeed, startQueries } from "./chat-seed";

const id = conversation.id as ConversationId;

const seed: ChatSeed = {
  conversation,
  path: branchPath,
  runs: { items: [runAwaitingApproval], nextCursor: null },
};

/** What the API says now: the run has ended, and the chat has a title. */
const later = {
  conversation: { ...conversation, title: "Renamed since" },
  path: { ...branchPath, messages: branchPath.messages.slice(0, 1) },
  runs: { items: [], nextCursor: null },
};

const setup = () => {
  const api = fakeApi({
    "GET /conversations/:conversationId/path": () => later.path,
    "GET /conversations/:conversationId/runs": () => later.runs,
    "GET /conversations/:id": () => later.conversation,
  });
  const client = createApiClient({
    baseUrl: "http://api.test",
    fetch: api.fetch,
  });
  const query = createQueryUtils(client);
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const keys = {
    conversation: query.conversations.get.queryKey({ input: { id } }),
    path: query.messages.path.queryKey({ input: { conversationId: id } }),
    runs: query.runs.list.queryKey({
      input: { active: true, conversationId: id, limit: 5 },
    }),
  };
  const settled = () =>
    vi.waitFor(() => {
      if (queryClient.isFetching() > 0) {
        throw new Error("still fetching");
      }
    });
  return { api, client, keys, query, queryClient, settled };
};

describe("startQueries", () => {
  it("fills the chat's queries from the seed without asking the API", async () => {
    const { api, client, keys, query, queryClient, settled } = setup();
    startQueries(queryClient, { client, query }, id, Promise.resolve(seed));
    await settled();
    expect(queryClient.getQueryData(keys.conversation)).toEqual(
      seed.conversation
    );
    expect(queryClient.getQueryData(keys.path)).toEqual(seed.path);
    expect(queryClient.getQueryData(keys.runs)).toEqual(seed.runs);
    expect(api.calls).toEqual([]);
  });

  it("answers once: a later refetch asks the API, not the seed", async () => {
    const { api, client, keys, query, queryClient, settled } = setup();
    startQueries(queryClient, { client, query }, id, Promise.resolve(seed));
    await settled();
    // An invalidation with nothing mounted refetches with the query's own
    // options, which are the seed's.
    await queryClient.refetchQueries({ type: "all" });
    await settled();
    expect(queryClient.getQueryData(keys.conversation)).toEqual(
      later.conversation
    );
    expect(queryClient.getQueryData(keys.path)).toEqual(later.path);
    expect(queryClient.getQueryData(keys.runs)).toEqual(later.runs);
    expect(api.calls.map((call) => call.route).sort()).toEqual([
      `GET /conversations/${id}`,
      `GET /conversations/${id}/path`,
      `GET /conversations/${id}/runs`,
    ]);
  });

  it("asks the API when the server had nothing to seed", async () => {
    const { api, client, keys, query, queryClient, settled } = setup();
    startQueries(queryClient, { client, query }, id, Promise.resolve(null));
    await settled();
    expect(queryClient.getQueryData(keys.path)).toEqual(later.path);
    expect(api.calls).toHaveLength(3);
  });

  it("treats a failed seed as no seed", async () => {
    const { api, client, keys, query, queryClient, settled } = setup();
    startQueries(
      queryClient,
      { client, query },
      id,
      Promise.reject(new Error("stream aborted"))
    );
    await settled();
    expect(queryClient.getQueryData(keys.runs)).toEqual(later.runs);
    expect(api.calls).toHaveLength(3);
  });
});
