"use client";

import { useQueries } from "@tanstack/react-query";
import type { ApiClient, QueryUtils } from "@workspace/client/api";
import type { ComposerFill } from "@workspace/composer/props";
import type {
  ComposerStatus,
  ComposerValue,
} from "@workspace/composer/schemas";
import type {
  ConversationId,
  MessageId,
  RunId,
  UserId,
} from "@workspace/contract/schemas/common";
import type { Message } from "@workspace/contract/schemas/messages";
import type { Run, TurnDelivery } from "@workspace/contract/schemas/runs";
import { useCallback, useMemo, useRef, useState } from "react";

import { type QueuedTurn, queuedTurns } from "../model/queue";
import { runInFront } from "../model/run-activity";
import type { QueueActions } from "./queue-tray";

/**
 * The composer's queue (D25's branch queue, from the active runs): the
 * turns waiting, their actions, and the text an Edit puts back in the
 * composer. A queued message the branch on screen doesn't have (another
 * branch is open) is read on its own for its text.
 */
export const useQueue = ({
  activeRuns,
  api,
  client,
  messages,
  refresh,
  viewer,
}: {
  readonly activeRuns: readonly Run[] | undefined;
  readonly api: QueryUtils;
  readonly client: ApiClient;
  readonly messages: readonly Message[];
  readonly refresh: () => void;
  /** Who is looking: only their own queued turns get actions. */
  readonly viewer: UserId;
}) => {
  const listed = useMemo(
    () => queuedTurns(activeRuns, messages, viewer),
    [activeRuns, messages, viewer]
  );
  const missing = useQueries({
    queries: listed
      .filter((turn) => turn.text === null)
      .map((turn) =>
        api.messages.get.queryOptions({ input: { id: turn.messageId } })
      ),
  });
  const fetched = missing.flatMap((query) => (query.data ? [query.data] : []));
  const turns = useMemo(
    () =>
      fetched.length === 0
        ? listed
        : queuedTurns(activeRuns, [...messages, ...fetched], viewer),
    [activeRuns, fetched, listed, messages, viewer]
  );

  const [pending, setPending] = useState<ReadonlySet<RunId>>(() => new Set());
  const [fill, setFill] = useState<ComposerFill>();
  // Rejects as the server did, for the tray to say why.
  const act = useCallback(
    async <T>(turn: QueuedTurn, action: () => Promise<T>): Promise<T> => {
      setPending((current) => new Set(current).add(turn.runId));
      try {
        return await action();
      } finally {
        setPending((current) => {
          const next = new Set(current);
          next.delete(turn.runId);
          return next;
        });
        refresh();
      }
    },
    [refresh]
  );
  const actions = useMemo(
    (): QueueActions => ({
      // A turn queued under it keeps its message in the chat, as a stopped
      // question: then the text stays there, not back in the composer.
      onEdit: (turn) =>
        act(turn, async () => {
          const { messageRemoved } = await client.runs.withdraw({
            id: turn.runId,
          });
          if (messageRemoved) {
            setFill((last) => ({
              id: (last?.id ?? 0) + 1,
              text: turn.text ?? "",
            }));
          }
          return { kept: !messageRemoved };
        }),
      onRemove: (turn) =>
        act(turn, async () => {
          const { messageRemoved } = await client.runs.withdraw({
            id: turn.runId,
          });
          return { kept: !messageRemoved };
        }),
      onSteer: async (turn) => {
        await act(turn, () => client.runs.steer({ id: turn.runId }));
      },
    }),
    [act, client]
  );
  const composer = useMemo(() => (fill ? { fill } : {}), [fill]);
  return { actions, composer, pending, turns };
};

type CreateRun = Parameters<ApiClient["runs"]["create"]>[0];

/**
 * Sends a message while an answer is being written. It goes straight to
 * the server, not through `useChat` (which follows one stream): the server
 * queues it behind that answer, or the answer takes it as a steer, and the
 * page follows whichever run comes next as it does any queued turn.
 */
export const useSendBusy = <Outgoing>({
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
  readonly input: (
    text: string,
    outgoing: Outgoing,
    parentId: MessageId | null
  ) => CreateRun["input"];
  readonly refresh: () => void;
  readonly runFields: () => Pick<CreateRun, "context" | "options" | "target">;
}) => {
  const at = useRef<MessageId | null>(null);
  at.current = answering ?? branch.at(-1)?.id ?? null;
  return useCallback(
    async (text: string, outgoing: Outgoing, delivery: TurnDelivery) => {
      if (!conversationId) {
        return;
      }
      const fields = runFields();
      await client.runs.create({
        ...fields,
        conversationId,
        input: input(text, outgoing, at.current),
        options: { ...fields.options, delivery },
      });
      refresh();
    },
    [client, conversationId, input, refresh, runFields]
  );
};

/**
 * The composer while an answer is on its way: Enter queues (`delivery`),
 * and Mod+Enter or Steer steers. Only once the server has the answer's run
 * (it streams, or the active runs list it), so nothing lands ahead of it.
 */
export const useBusyComposer = ({
  activeRuns,
  conversationId,
  status,
  submit,
  uploadFailed,
}: {
  readonly activeRuns: readonly Run[] | undefined;
  readonly conversationId: ConversationId | null;
  readonly status: ComposerStatus;
  readonly submit: (
    value: ComposerValue,
    delivery?: TurnDelivery
  ) => Promise<void>;
  readonly uploadFailed: (failed: boolean) => void;
}): {
  readonly delivery: TurnDelivery | undefined;
  readonly onSteer: ((value: ComposerValue) => void) | undefined;
} => {
  const steer = useCallback(
    (value: ComposerValue) => {
      uploadFailed(false);
      submit(value, "steer").catch(() => uploadFailed(true));
    },
    [submit, uploadFailed]
  );
  const runExists =
    status === "streaming" ||
    (status === "submitted" && runInFront(activeRuns ?? []) !== undefined);
  return conversationId !== null && runExists
    ? { delivery: "queue", onSteer: steer }
    : { delivery: undefined, onSteer: undefined };
};
