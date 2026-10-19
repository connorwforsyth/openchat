import type { ConversationId } from "@workspace/contract/schemas/common";
import type { Conversation } from "@workspace/contract/schemas/conversations";
import { z } from "zod";

// The sidebar's "Needs attention" section (176): chats with a run in flight,
// a run waiting on the user's approval, or a reply the user hasn't read. Read
// state is derived from the caller's `myState.lastReadAt` against the chat's
// `lastMessageAt`, so it needs no contract change. Run signals come from
// whoever knows them (the Dots list today, the live run of the open chat);
// they're a parameter so this stays pure.

/** Most urgent first: the order the section lists them in. */
export const attentionSchema = z.enum([
  "awaiting_approval",
  "failed",
  "running",
  "unread",
]);
export type Attention = z.infer<typeof attentionSchema>;

/** A run signal for a chat, from outside the conversation list. */
export const runSignalSchema = z.enum([
  "awaiting_approval",
  "failed",
  "running",
]);
export type RunSignal = z.infer<typeof runSignalSchema>;

export type AttentionChat = Pick<
  Conversation,
  "id" | "lastMessageAt" | "updatedAt"
> & {
  readonly myState?: Pick<Conversation["myState"], "lastReadAt">;
};

/**
 * True when there's a message newer than the last time the user read the
 * chat. A chat never opened (`lastReadAt` null) that has any message counts
 * as unread (176): a scheduled run or a Dot can start a chat the user has
 * never seen. A chat the user starts is marked read as it opens.
 */
export const isUnread = (chat: AttentionChat): boolean => {
  // No `myState` at all means the caller doesn't track reads: read.
  if (chat.lastMessageAt === null || chat.myState === undefined) {
    return false;
  }
  const { lastReadAt } = chat.myState;
  return (
    lastReadAt === null ||
    new Date(chat.lastMessageAt).getTime() > new Date(lastReadAt).getTime()
  );
};

/** The most urgent reason a chat needs the user, if any. */
export const attentionFor = (
  chat: AttentionChat,
  signal: RunSignal | undefined
): Attention | null => signal ?? (isUnread(chat) ? "unread" : null);

export interface AttentionItem<T> {
  readonly attention: Attention;
  readonly chat: T;
}

const rank = (attention: Attention): number =>
  attentionSchema.options.indexOf(attention);

const activity = (chat: AttentionChat): number =>
  new Date(chat.lastMessageAt ?? chat.updatedAt).getTime();

/** Chats that need the user, most urgent first, then newest first. */
export const needsAttention = <T extends AttentionChat>(
  chats: readonly T[],
  signals: ReadonlyMap<ConversationId, RunSignal>
): readonly AttentionItem<T>[] =>
  chats
    .flatMap((chat) => {
      const attention = attentionFor(chat, signals.get(chat.id));
      return attention === null ? [] : [{ attention, chat }];
    })
    .sort(
      (a, b) =>
        rank(a.attention) - rank(b.attention) ||
        activity(b.chat) - activity(a.chat)
    );

/** The next chat needing attention after `activeId`, wrapping round (⌥⌘A). */
export const nextNeedingAttention = (
  items: readonly AttentionItem<AttentionChat>[],
  activeId: ConversationId | null
): ConversationId | null => {
  if (items.length === 0) {
    return null;
  }
  const at = items.findIndex((item) => item.chat.id === activeId);
  const next = items[(at + 1) % items.length];
  return next ? next.chat.id : null;
};

/**
 * The `lastReadAt` that leaves a chat unread: just before its last message.
 * `null` when there's nothing to be unread about.
 */
export const unreadMarker = (chat: AttentionChat): string | null =>
  chat.lastMessageAt === null
    ? null
    : new Date(new Date(chat.lastMessageAt).getTime() - 1).toISOString();
