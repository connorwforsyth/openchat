import type { ConversationId } from "@workspace/contract/schemas/common";

// A new chat's first messages (134). The chat is created on the first send,
// and the message goes once the page has moved to the chat's address. A
// message sent before then (an "Ask AI" prompt or a command racing the
// first send) joins the same chat, after the first, instead of making a
// second chat and taking the first one's place. The composer is busy
// meanwhile, as it is while any run starts, so a typed message waits in it.
// Pure.

export interface FirstSend<T> {
  /** The chat being made, once it exists; `null` while it's created. */
  readonly conversationId: ConversationId | null;
  /** Messages waiting for the chat's address, in the order they were sent. */
  readonly queue: readonly T[];
}

/** A first send has begun: the chat is being made. */
export const firstSendStarted = <T>(
  current: FirstSend<T> | null
): FirstSend<T> => current ?? { conversationId: null, queue: [] };

/** A message is ready to go in the chat that was made for it. */
export const firstSendQueued = <T>(
  current: FirstSend<T> | null,
  conversationId: ConversationId,
  item: T
): FirstSend<T> => {
  const sameChat =
    current !== null &&
    (current.conversationId === null ||
      current.conversationId === conversationId);
  return {
    conversationId,
    queue: [...(sameChat ? current.queue : []), item],
  };
};

/**
 * A message didn't get ready (the chat couldn't be made, or its files
 * didn't upload). Messages already waiting still go; with none, the first
 * send is over and the composer is free again.
 */
export const firstSendFailed = <T>(
  current: FirstSend<T> | null
): FirstSend<T> | null =>
  current && current.queue.length === 0 && current.conversationId === null
    ? null
    : current;

/**
 * The next message to send, once the page shows its chat and nothing it
 * sent before is still being answered; and what's left after it.
 */
export const firstSendNext = <T>(
  current: FirstSend<T> | null,
  {
    conversationId,
    sending,
  }: {
    readonly conversationId: ConversationId | null;
    readonly sending: boolean;
  }
): { readonly item: T; readonly rest: FirstSend<T> | null } | null => {
  if (
    sending ||
    current === null ||
    current.conversationId === null ||
    current.conversationId !== conversationId
  ) {
    return null;
  }
  const [item, ...queue] = current.queue;
  if (item === undefined) {
    return null;
  }
  return {
    item,
    rest:
      queue.length > 0
        ? { conversationId: current.conversationId, queue }
        : null,
  };
};

/**
 * Whether the composer waits for a first send: while the chat is made, the
 * page moves to it, and its messages go. Not in another chat opened
 * meanwhile.
 */
export const firstSendBusy = (
  current: FirstSend<unknown> | null,
  conversationId: ConversationId | null
): boolean =>
  current !== null &&
  (conversationId === null ||
    current.conversationId === null ||
    current.conversationId === conversationId);
