import { fromUIMessage } from "@workspace/ai/messages/from-ui";
import type {
  ConversationId,
  MessageId,
  UserId,
} from "@workspace/contract/schemas/common";
import type { MessagePart } from "@workspace/contract/schemas/message-parts";
import type { Message } from "@workspace/contract/schemas/messages";
import type { UIMessage } from "ai";

// While a turn streams, the newest messages exist only in `useChat` (AI SDK
// `UIMessage`s); everything before them is the stored branch. The view shows
// the stored path plus that live tail, mapped to our parts, until the run
// finishes and the refreshed path includes them.

/** Live messages after the last one the stored path already has. */
export const liveTail = (
  pathIds: ReadonlySet<string>,
  live: readonly UIMessage[]
): readonly UIMessage[] => {
  let lastKnown = -1;
  live.forEach((message, index) => {
    if (pathIds.has(message.id)) {
      lastKnown = index;
    }
  });
  return live.slice(lastKnown + 1);
};

/**
 * A streaming message's parts in our schema, for display. Approval outcomes
 * aren't in the stream (the run holds them), so if mapping needs one the
 * text and reasoning still show; the stored message replaces this anyway.
 */
export const liveParts = (message: Pick<UIMessage, "parts">): MessagePart[] => {
  const mapped = fromUIMessage(message, {
    decisionFor: () => undefined,
    now: () => new Date(),
  });
  if (mapped.ok) {
    return mapped.value;
  }
  return message.parts.flatMap((part): MessagePart[] =>
    part.type === "text" || part.type === "reasoning"
      ? [{ text: part.text, type: part.type }]
      : []
  );
};

/** A live `UIMessage` as a `Message` the conversation view can render. */
export const liveMessage = (
  message: UIMessage,
  context: {
    readonly authorId: UserId;
    readonly conversationId: ConversationId;
    readonly createdAt: string;
    readonly parentId: MessageId | null;
  }
): Message => ({
  agent: null,
  authorId: message.role === "user" ? context.authorId : null,
  conversationId: context.conversationId,
  createdAt: context.createdAt,
  id: message.id as MessageId,
  model: null,
  parentId: context.parentId,
  parts: liveParts(message),
  partsVersion: 1,
  role: message.role,
  runId: null,
  status: "complete",
  usage: null,
});

/**
 * The stored path followed by the live tail, parents chained. `cache` keeps
 * a live message's mapping while its `UIMessage` is unchanged, so rows stay
 * memoised and a token re-renders only the message it landed in (D28).
 */
export const mergeLive = (
  path: readonly Message[],
  live: readonly UIMessage[],
  context: {
    readonly authorId: UserId;
    readonly conversationId: ConversationId;
    readonly now: string;
  },
  cache?: WeakMap<UIMessage, Message>
): readonly Message[] => {
  const tail = liveTail(new Set(path.map((message) => message.id)), live);
  if (tail.length === 0) {
    return path;
  }
  const merged: Message[] = [...path];
  for (const message of tail) {
    const parentId = merged.at(-1)?.id ?? null;
    const cached = cache?.get(message);
    const mapped =
      cached && cached.parentId === parentId
        ? cached
        : liveMessage(message, {
            authorId: context.authorId,
            conversationId: context.conversationId,
            createdAt: context.now,
            parentId,
          });
    cache?.set(message, mapped);
    merged.push(mapped);
  }
  return merged;
};
