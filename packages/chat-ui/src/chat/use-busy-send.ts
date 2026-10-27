"use client";

import type { ApiClient } from "@workspace/client/api";
import type { ComposerStatus } from "@workspace/composer/schemas";
import type {
  ConversationId,
  MessageId,
} from "@workspace/contract/schemas/common";
import type { Message } from "@workspace/contract/schemas/messages";
import type { Run } from "@workspace/contract/schemas/runs";
import { useCallback, useRef } from "react";

import { runInFront } from "../model/run-activity";

type CreateRun = Parameters<ApiClient["runs"]["create"]>[0];

/**
 * Sends a message while an answer is being written. It goes straight to
 * the server, not through `useChat` (which follows one stream), and into the
 * thread at once: the server decides how the answer takes it (joins the
 * batch, restarts the answer, or takes it at the next step), and the page
 * follows whichever run answers it.
 */
export const useSendBusy = <Payload>({
  answering,
  branch,
  client,
  conversationId,
  input,
  refresh,
  runFields,
}: {
  /** The answer being written, which it follows. */
  readonly answering: MessageId | null;
  /** The branch on screen, whose last message it follows otherwise. */
  readonly branch: readonly Pick<Message, "id">[];
  readonly client: ApiClient;
  readonly conversationId: ConversationId | null;
  /** What's sent, as the run's `input`, after `parentId`. */
  readonly input: (
    payload: Payload,
    parentId: MessageId | null
  ) => CreateRun["input"];
  readonly refresh: () => void;
  readonly runFields: () => Pick<CreateRun, "context" | "options" | "target">;
}) => {
  // The last message sent this way, until the branch on screen has it: the
  // next quick message follows it, not the older end the page still shows.
  const sent = useRef<MessageId | null>(null);
  // biome-ignore lint/suspicious/noUnnecessaryConditions: the send below sets it after this render's read.
  if (sent.current && branch.some((message) => message.id === sent.current)) {
    sent.current = null;
  }
  const at = useRef<MessageId | null>(null);
  at.current = sent.current ?? answering ?? branch.at(-1)?.id ?? null;
  return useCallback(
    async (payload: Payload) => {
      if (!conversationId) {
        return;
      }
      const created = await client.runs.create({
        ...runFields(),
        conversationId,
        input: input(payload, at.current),
      });
      sent.current = created.userMessageId;
      at.current = created.userMessageId;
      refresh();
    },
    [client, conversationId, input, refresh, runFields]
  );
};

/**
 * Whether the composer sends while an answer is on its way: once the
 * server has the answer's run (it streams, or the active runs list it), so
 * nothing lands ahead of it.
 */
export const useBusyComposer = ({
  activeRuns,
  conversationId,
  status,
}: {
  readonly activeRuns: readonly Run[] | undefined;
  readonly conversationId: ConversationId | null;
  readonly status: ComposerStatus;
}): boolean =>
  conversationId !== null &&
  (status === "streaming" ||
    (status === "submitted" && runInFront(activeRuns ?? []) !== undefined));
