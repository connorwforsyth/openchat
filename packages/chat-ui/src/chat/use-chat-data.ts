"use client";

import {
  skipToken,
  useMutation,
  useQueries,
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
import type { Feedback } from "@workspace/contract/schemas/feedback";
import type { Message } from "@workspace/contract/schemas/messages";
import { useCallback, useMemo, useState } from "react";
import type { z } from "zod";

import type { FeedbackInput } from "../conversation/actions";
import type { MessageFeedback } from "../conversation/feedback";

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

const toFeedback = (
  feedback: Feedback | null | undefined
): MessageFeedback | undefined =>
  feedback
    ? {
        comment: feedback.comment,
        rating: feedback.rating,
        shareWithMaintainers: feedback.shareWithMaintainers,
      }
    : undefined;

/**
 * The user's feedback on the answers shown: fetched per message, overridden
 * locally the moment they click (D28), and sent in the background.
 */
export const useFeedback = (api: QueryUtils, messages: readonly Message[]) => {
  const [overrides, setOverrides] = useState<
    Readonly<Record<string, MessageFeedback | null>>
  >({});
  const assistantIds = useMemo(
    () =>
      messages.flatMap((message) =>
        message.role === "assistant" ? [message.id] : []
      ),
    [messages]
  );
  const stored = useQueries({
    queries: assistantIds.map((messageId) =>
      api.feedback.get.queryOptions({ input: { messageId }, retry: false })
    ),
  });
  const { mutate: send } = useMutation(api.feedback.set.mutationOptions());
  const { mutate: remove } = useMutation(api.feedback.delete.mutationOptions());

  const byMessage = useMemo(() => {
    const merged: Record<string, MessageFeedback> = {};
    assistantIds.forEach((messageId, index) => {
      const known =
        messageId in overrides
          ? overrides[messageId]
          : toFeedback(stored[index]?.data);
      if (known) {
        merged[messageId] = known;
      }
    });
    return merged;
  }, [assistantIds, overrides, stored]);

  const set = useCallback(
    (input: FeedbackInput) => {
      const shareWithMaintainers = input.shareWithMaintainers ?? false;
      setOverrides((previous) => ({
        ...previous,
        [input.messageId]: {
          comment: input.comment ?? null,
          rating: input.rating,
          shareWithMaintainers,
        },
      }));
      send({ ...input, shareWithMaintainers });
    },
    [send]
  );
  const clear = useCallback(
    (messageId: MessageId) => {
      setOverrides((previous) => ({ ...previous, [messageId]: null }));
      remove({ messageId });
    },
    [remove]
  );
  const reset = useCallback(() => setOverrides({}), []);

  return { byMessage, clear, reset, set };
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
