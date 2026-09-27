"use client";

import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type { QueryUtils } from "@workspace/client/api";
import type { MessageId } from "@workspace/contract/schemas/common";
import type { Feedback } from "@workspace/contract/schemas/feedback";
import type { Message } from "@workspace/contract/schemas/messages";
import { useCallback, useMemo, useState } from "react";

import type { FeedbackInput } from "../conversation/actions";
import type { MessageFeedback } from "../conversation/feedback";

/** A message id as the API's inputs take it. */
type AnswerId = FeedbackInput["messageId"];

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

/** The query key for one branch's feedback: under `feedback`, so invalidating that covers it. */
export const branchFeedbackKey = (
  api: QueryUtils,
  messageIds: readonly MessageId[]
) => [...api.feedback.key(), "branch", messageIds] as const;

/**
 * The user's feedback on the answers in the branch being viewed, as one query
 * per branch (not one per message), overridden locally the moment they click
 * (D28) and sent in the background.
 *
 * The contract has no "list feedback" procedure yet, so the query looks up
 * each answer with `feedback.get`, all in the same tick (a batching link
 * sends them as one request), and remembers each answer's feedback: a new
 * turn, or another branch through the same answers, only asks about the
 * answers it hasn't seen.
 */
export const useBranchFeedback = (
  api: QueryUtils,
  messages: readonly Message[]
) => {
  const queryClient = useQueryClient();
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

  const perMessage = useCallback(
    (messageId: AnswerId) =>
      api.feedback.get.queryOptions({
        input: { messageId },
        retry: false,
        // Only this user writes their feedback, and every write below
        // updates this entry, so what's cached stays true.
        staleTime: Number.POSITIVE_INFINITY,
      }),
    [api]
  );

  const stored = useQuery({
    enabled: assistantIds.length > 0,
    // Keep showing the last branch's thumbs while a new turn's are looked up.
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const found = await Promise.all(
        assistantIds.map((messageId) =>
          queryClient
            .fetchQuery(perMessage(messageId))
            // An answer we can't read feedback for shows no thumbs pressed.
            .catch(() => null)
        )
      );
      return Object.fromEntries(
        assistantIds.map((messageId, index) => [messageId, found[index]])
      );
    },
    queryKey: branchFeedbackKey(api, assistantIds),
  });

  const remember = useCallback(
    (messageId: AnswerId, feedback: Feedback | null) =>
      queryClient.setQueryData(perMessage(messageId).queryKey, () => feedback),
    [perMessage, queryClient]
  );
  const { mutate: send } = useMutation(api.feedback.set.mutationOptions());
  const { mutate: remove } = useMutation(api.feedback.delete.mutationOptions());

  const byMessage = useMemo(() => {
    const merged: Record<string, MessageFeedback> = {};
    for (const messageId of assistantIds) {
      const known =
        messageId in overrides
          ? overrides[messageId]
          : toFeedback(stored.data?.[messageId]);
      if (known) {
        merged[messageId] = known;
      }
    }
    return merged;
  }, [assistantIds, overrides, stored.data]);

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
      send(
        { ...input, shareWithMaintainers },
        { onSuccess: (saved) => remember(input.messageId, saved) }
      );
    },
    [remember, send]
  );
  const clear = useCallback(
    (messageId: MessageId) => {
      setOverrides((previous) => ({ ...previous, [messageId]: null }));
      remove({ messageId }, { onSuccess: () => remember(messageId, null) });
    },
    [remember, remove]
  );
  const reset = useCallback(() => setOverrides({}), []);

  return { byMessage, clear, reset, set };
};
