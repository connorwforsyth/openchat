"use client";

import {
  skipToken,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type { QueryUtils } from "@workspace/client/api";
import type {
  ArtifactId,
  ConversationId,
  MessageId,
} from "@workspace/contract/schemas/common";
import type {
  Conversation,
  updateConversationInputSchema,
} from "@workspace/contract/schemas/conversations";
import type { z } from "zod";

// The queries and mutations behind `ConnectedChat`, split out so each piece
// reads on its own. Keys come from the contract through
// `@orpc/tanstack-query` (D11).

export const SIDEBAR_LIST_INPUT = { archived: false, limit: 100 } as const;

/** Everything stored the chat screen reads for one conversation. */
export const useChatQueries = (
  api: QueryUtils,
  {
    artifactId,
    conversationId,
    leafId,
    sandboxes,
  }: {
    readonly artifactId: ArtifactId | null;
    readonly conversationId: ConversationId | null;
    readonly leafId: MessageId | undefined;
    readonly sandboxes: boolean;
  }
) => {
  const byConversation = conversationId ? { conversationId } : skipToken;
  const byId = conversationId ? { id: conversationId } : skipToken;
  const chats = useQuery(
    api.conversations.list.queryOptions({ input: SIDEBAR_LIST_INPUT })
  );
  const conversation = useQuery(
    api.conversations.get.queryOptions({ input: byId })
  );
  const path = useQuery(
    api.messages.path.queryOptions({
      input: conversationId ? { conversationId, leafId } : skipToken,
    })
  );
  const tree = useQuery(
    api.messages.tree.queryOptions({ input: byConversation })
  );
  const participants = useQuery(
    api.conversations.participants.queryOptions({ input: byId })
  );
  const runs = useQuery(
    api.runs.list.queryOptions({
      input: conversationId
        ? { active: true, conversationId, limit: 5 }
        : skipToken,
    })
  );
  const artifacts = useQuery(
    api.artifacts.list.queryOptions({ input: byConversation })
  );
  const selectedArtifactId = artifactId ?? artifacts.data?.[0]?.id ?? null;
  const versions = useQuery(
    api.artifacts.listVersions.queryOptions({
      input: selectedArtifactId ? { id: selectedArtifactId } : skipToken,
    })
  );
  const sandbox = useQuery(
    api.sandbox.get.queryOptions({ enabled: sandboxes, input: byConversation })
  );
  const activeRun = runs.data?.items.find(
    (run) => run.state.status === "awaiting_approval"
  );
  return {
    activeRun,
    artifacts,
    chats,
    conversation,
    participants,
    path,
    sandbox,
    selectedArtifactId,
    tree,
    versions,
  };
};

type ConversationUpdate = z.input<typeof updateConversationInputSchema>;
interface ConversationPage {
  readonly items: Conversation[];
  readonly nextCursor: string | null;
}

const applyUpdate = (
  item: Conversation,
  input: ConversationUpdate
): Conversation =>
  item.id === input.id
    ? {
        ...item,
        archived: input.archived ?? item.archived,
        pinned: input.pinned ?? item.pinned,
        title: input.title ?? item.title,
      }
    : item;

/**
 * Rename, pin, archive and restore, applied to the cached sidebar list first
 * and rolled back if the server says no (D28).
 */
export const useConversationUpdate = (api: QueryUtils) => {
  const queryClient = useQueryClient();
  const listKey = api.conversations.list.queryKey({
    input: SIDEBAR_LIST_INPUT,
  });
  const { mutate } = useMutation(
    api.conversations.update.mutationOptions<ConversationPage | undefined>({
      onError: (_error, _input, previous) => {
        queryClient.setQueryData(listKey, previous);
      },
      onMutate: async (input) => {
        await queryClient.cancelQueries({ queryKey: listKey });
        const previous: ConversationPage | undefined =
          queryClient.getQueryData(listKey);
        queryClient.setQueryData(listKey, (page) =>
          page
            ? {
                ...page,
                items: page.items
                  .map((item) => applyUpdate(item, input))
                  .filter((item) => !item.archived),
              }
            : page
        );
        return previous;
      },
      onSettled: () =>
        queryClient.invalidateQueries({ queryKey: api.conversations.key() }),
    })
  );
  return mutate;
};
