"use client";

import { useChat } from "@ai-sdk/react";
import type { UIMessage } from "ai";
import { useEffect, useMemo, useRef } from "react";

import {
  createRunTransport,
  type RunCreated,
  type RunTransportOptions,
  userParts,
} from "./run-transport";

// `useChat` over runs, for the conversation view (015) and integration
// (025). Sending is optimistic (D28): the message shows at once under a
// client id and takes the server's id when `POST /api/runs` answers.
// Streamed updates re-render at most once a frame (D28), so a fast model
// can't render faster than the screen does.

/** About one animation frame at 60 Hz. */
export const STREAM_THROTTLE_MS = 16;

export interface UseRunChatOptions
  extends Pick<
    RunTransportOptions,
    "baseUrl" | "client" | "fetch" | "headers" | "runFields" | "toParts"
  > {
  readonly conversationId: string;
  /** The branch as the server has it (`messages.path`, mapped with `toUIMessages`). */
  readonly initialMessages?: UIMessage[];
  readonly onError?: (error: Error) => void;
  /** Called when an answer finishes streaming: invalidate or patch the query cache here (D11). */
  readonly onFinish?: (message: UIMessage) => void;
  readonly onRunCreated?: (run: RunCreated) => void;
  /** Pick up a run that was still going when the page loaded. */
  readonly resume?: boolean;
}

/** Swaps a client-side message id for the stored one. Pure. */
export const reconcileId = (
  messages: readonly UIMessage[],
  clientId: string,
  serverId: string
): UIMessage[] =>
  messages.map((message) =>
    message.id === clientId ? { ...message, id: serverId } : message
  );

export const useRunChat = ({
  baseUrl,
  client,
  conversationId,
  fetch,
  headers,
  initialMessages,
  onError,
  onFinish,
  onRunCreated,
  resume = false,
  runFields,
  toParts,
}: UseRunChatOptions) => {
  // Callbacks change every render; the transport reads the latest through
  // refs so it's built once per conversation.
  const latest = useRef({ headers, onRunCreated, runFields, toParts });
  useEffect(() => {
    latest.current = { headers, onRunCreated, runFields, toParts };
  });
  const setMessages = useRef<
    ((update: (messages: UIMessage[]) => UIMessage[]) => void) | null
  >(null);

  const transport = useMemo(
    () =>
      createRunTransport({
        baseUrl,
        client,
        fetch,
        headers: () => latest.current.headers?.() ?? {},
        onRunCreated: (run) => {
          const { clientMessageId } = run;
          if (clientMessageId && clientMessageId !== run.userMessageId) {
            setMessages.current?.((messages) =>
              reconcileId(messages, clientMessageId, run.userMessageId)
            );
          }
          latest.current.onRunCreated?.(run);
        },
        runFields: (chatId) => latest.current.runFields?.(chatId) ?? {},
        toParts: (message) => (latest.current.toParts ?? userParts)(message),
      }),
    [baseUrl, client, fetch]
  );

  const chat = useChat({
    id: conversationId,
    messages: initialMessages,
    onError,
    onFinish: onFinish ? ({ message }) => onFinish(message) : undefined,
    resume,
    throttle: STREAM_THROTTLE_MS,
    transport,
  });
  setMessages.current = chat.setMessages;
  return chat;
};
