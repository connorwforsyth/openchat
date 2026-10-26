import {
  ANNOTATIONS_DATA,
  annotationsDataSchema,
} from "@workspace/ai/messages/annotations";
import { CHIPS_DATA, chipsDataSchema } from "@workspace/ai/messages/chips";
import { SKILLS_DATA, skillsDataSchema } from "@workspace/ai/messages/skills";
import {
  WORKSPACE_FILE_DATA,
  workspaceFileRefSchema,
} from "@workspace/ai/messages/workspace-file";
import type {
  ConversationId,
  JsonValue,
  MessageId,
  RunId,
} from "@workspace/contract/schemas/common";
import type { UserMessagePart } from "@workspace/contract/schemas/message-parts";
import type {
  CreateRunInput,
  CreateRunOutput,
  PickedSkill,
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
  /** Maps a message the user sent to stored parts; the default keeps text, uploaded files and `@file` mentions. */
  readonly toParts?: (message: UIMessage) => UserMessagePart[];
}

const UPLOADED = /\/api\/files\/([0-9a-f-]{36})\/content$/i;
const ABSOLUTE = /^https?:\/\//;
const TRAILING_SLASH = /\/$/;
/** Enough to reach the answer being written past the turns queued after it. */
const ACTIVE_RUNS = 20;

interface Check {
  readonly safeParse: (
    data: unknown
  ) =>
    | { readonly data: unknown; readonly success: true }
    | { readonly success: false };
}

/**
 * The data parts a sent message keeps, each checked by its feature's
 * schema: `@file` mentions, chips and notes pinned on an artifact.
 */
const SENT_DATA = new Map<string, Check>([
  [WORKSPACE_FILE_DATA, workspaceFileRefSchema],
  [CHIPS_DATA, chipsDataSchema],
  [ANNOTATIONS_DATA, annotationsDataSchema],
]);

const sentData = (type: string, data: unknown): UserMessagePart[] => {
  const name = type.slice("data-".length);
  const parsed = SENT_DATA.get(name)?.safeParse(data);
  return parsed?.success
    ? [{ data: parsed.data as JsonValue, name, type: "data" }]
    : [];
};

/**
 * Text, file, workspace-file mention, chips and annotations parts of a
 * `UIMessage` as the contract's user parts. A part the server can't read
 * is dropped here rather than stored. Pure.
 */
export const userParts = (message: UIMessage): UserMessagePart[] =>
  message.parts.flatMap((part): UserMessagePart[] => {
    if (part.type === "text") {
      return [{ text: part.text, type: "text" }];
    }
    if (part.type.startsWith("data-")) {
      return sentData(part.type, (part as { readonly data?: unknown }).data);
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
 * The skills picked for a message (127), from its `data-skills` part, as
 * the run's `input.skills`. The server checks them and keeps its own record
 * on the stored message; the part itself is never sent as one. Pure.
 */
export const pickedSkills = (message: UIMessage): PickedSkill[] => {
  const seen = new Set<string>();
  return message.parts.flatMap((part): PickedSkill[] => {
    if (part.type !== `data-${SKILLS_DATA}`) {
      return [];
    }
    const parsed = skillsDataSchema.safeParse(
      (part as { readonly data?: unknown }).data
    );
    return parsed.success
      ? parsed.data.skills.flatMap(({ id, versionId }) => {
          if (seen.has(id)) {
            return [];
          }
          seen.add(id);
          return [{ id, ...(versionId ? { versionId } : {}) }];
        })
      : [];
  });
};

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
    const skills = pickedSkills(last);
    return {
      parentId: (parent?.id ?? null) as MessageId | null,
      parts: toParts(last),
      ...(skills.length > 0 ? { skills } : {}),
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
      // The run in front, from the server: after an answer, the turn queued
      // behind it is the one to follow, not the stream this page last read.
      const active = await options.client.runs.list({
        active: true,
        conversationId: chatId as ConversationId,
        limit: ACTIVE_RUNS,
      });
      // Newest first: the answer being written, not a turn queued behind it.
      const run =
        active.items.find((each) => each.state.status !== "queued") ??
        active.items.at(-1);
      if (run) {
        return stream(chatId, `/api/runs/${run.id}/stream`, 0, abortSignal);
      }
      const known = current.get(chatId);
      // Replay from the start: the page's copy of the answer may be older
      // than the cursor if it was rebuilt from the server.
      return known ? stream(chatId, known.streamUrl, 0, abortSignal) : null;
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
