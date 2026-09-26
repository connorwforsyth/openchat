import type {
  ConversationId,
  MessageId,
  RunId,
} from "@workspace/contract/schemas/common";
import type { UserMessagePart } from "@workspace/contract/schemas/message-parts";
import type {
  CreateRunInput,
  CreateRunOutput,
} from "@workspace/contract/schemas/runs";
import type { ChatTransport, UIMessage, UIMessageChunk } from "ai";

import type { ApiClient } from "./api";
import { type RunStreamOptions, readRunStream } from "./run-stream";

// A `useChat` transport over runs (D4, D11). Sending creates a run with
// `POST /api/runs` and reads its stream; the stream resumes by itself after
// a dropped connection, and `reconnectToStream` picks up a run that was
// still going when the page loaded. The chat's id is the conversation id.
//
// Optimistic sending (D28): `useChat` shows the user's message the moment
// it's sent, under a client id. When the server answers, `onRunCreated`
// reports the stored id so the caller can swap it in (`useRunChat` does).

export interface RunCreated {
  /** The id `useChat` gave the message, if this turn added one. */
  readonly clientMessageId: string | null;
  readonly conversationId: ConversationId;
  readonly runId: RunId;
  readonly status: CreateRunOutput["status"];
  /** The stored user message's id. */
  readonly userMessageId: MessageId;
}

export interface RunTransportOptions
  extends Pick<RunStreamOptions, "fetch" | "headers" | "maxRetries"> {
  /** Origin of the server; `""` for same origin. */
  readonly baseUrl?: string;
  readonly client: Pick<ApiClient, "runs">;
  readonly onRunCreated?: (run: RunCreated) => void;
  /** Fields for `POST /api/runs` besides the turn: target, options, context. */
  readonly runFields?: (
    chatId: string
  ) => Pick<CreateRunInput, "context" | "options" | "target">;
  /** Maps a message the user sent to stored parts; the default keeps text and uploaded files. */
  readonly toParts?: (message: UIMessage) => UserMessagePart[];
}

const UPLOADED = /\/api\/files\/([0-9a-f-]{36})\/content$/i;
const ABSOLUTE = /^https?:\/\//;
const TRAILING_SLASH = /\/$/;

/** Text and file parts of a `UIMessage` as the contract's user parts. Pure. */
export const userParts = (message: UIMessage): UserMessagePart[] =>
  message.parts.flatMap((part): UserMessagePart[] => {
    if (part.type === "text") {
      return [{ text: part.text, type: "text" }];
    }
    if (part.type !== "file") {
      return [];
    }
    const uploaded = UPLOADED.exec(part.url);
    if (uploaded?.[1]) {
      return [
        {
          filename: part.filename,
          mediaType: part.mediaType,
          source: { fileId: uploaded[1] as never, kind: "file" },
          type: "file",
        },
      ];
    }
    return ABSOLUTE.test(part.url)
      ? [
          {
            filename: part.filename,
            mediaType: part.mediaType,
            source: { kind: "url", url: part.url },
            type: "file",
          },
        ]
      : [];
  });

/**
 * The turn `useChat` asks for, as a run input. A new message follows the
 * one before it; a regenerate answers the user message before the answer
 * being replaced. Pure.
 */
export const turnFor = (
  trigger: "submit-message" | "regenerate-message",
  messages: readonly UIMessage[],
  messageId: string | undefined,
  toParts: (message: UIMessage) => UserMessagePart[] = userParts
): CreateRunInput["input"] | null => {
  if (trigger === "submit-message") {
    const last = messages.at(-1);
    if (last?.role !== "user") {
      return null;
    }
    const parent = messages.at(-2);
    return {
      parentId: (parent?.id ?? null) as MessageId | null,
      parts: toParts(last),
      type: "message",
    };
  }
  const index = messageId
    ? messages.findIndex((message) => message.id === messageId)
    : messages.length;
  const question = messages
    .slice(0, index === -1 ? messages.length : index + 1)
    .filter((message) => message.role === "user")
    .at(-1);
  return question
    ? { type: "regenerate", userMessageId: question.id as MessageId }
    : null;
};

export const createRunTransport = (
  options: RunTransportOptions
): ChatTransport<UIMessage> => {
  const base = (options.baseUrl ?? "").replace(TRAILING_SLASH, "");
  /** Where each chat's current stream got to, for `reconnectToStream`. */
  const current = new Map<string, { cursor: number; streamUrl: string }>();

  const stream = (
    chatId: string,
    streamUrl: string,
    cursor: number,
    signal: AbortSignal | undefined
  ): ReadableStream<UIMessageChunk> => {
    const position = { cursor, streamUrl };
    current.set(chatId, position);
    return readRunStream(`${base}${streamUrl}`, {
      cursor,
      fetch: options.fetch,
      headers: options.headers,
      maxRetries: options.maxRetries,
      onCursor: (next) => {
        position.cursor = next;
      },
      signal,
    });
  };

  return {
    reconnectToStream: async ({ abortSignal, chatId }) => {
      const known = current.get(chatId);
      if (known) {
        // Replay from the start: the page's copy of the answer may be older
        // than the cursor if it was rebuilt from the server.
        return stream(chatId, known.streamUrl, 0, abortSignal);
      }
      const active = await options.client.runs.list({
        active: true,
        conversationId: chatId as ConversationId,
        limit: 1,
      });
      const [run] = active.items;
      return run
        ? stream(chatId, `/api/runs/${run.id}/stream`, 0, abortSignal)
        : null;
    },

    sendMessages: async ({
      abortSignal,
      chatId,
      messageId,
      messages,
      trigger,
    }) => {
      const input = turnFor(
        trigger,
        messages,
        messageId,
        options.toParts ?? userParts
      );
      if (!input) {
        throw new Error("Nothing to send: the last message isn't the user's.");
      }
      const created = await options.client.runs.create(
        {
          ...options.runFields?.(chatId),
          conversationId: chatId as ConversationId,
          input,
        },
        { signal: abortSignal }
      );
      options.onRunCreated?.({
        clientMessageId:
          trigger === "submit-message" ? (messages.at(-1)?.id ?? null) : null,
        conversationId: created.conversationId,
        runId: created.runId,
        status: created.status,
        userMessageId: created.userMessageId,
      });
      return stream(chatId, created.streamUrl, 0, abortSignal);
    },
  };
};
