import type { UserId } from "@workspace/contract/schemas/common";
import type {
  Conversation,
  Participant,
  ParticipantState,
} from "@workspace/contract/schemas/conversations";
import type { Message } from "@workspace/contract/schemas/messages";
import {
  type ConversationView,
  type ParticipantRow,
  type StoredContext,
  toChatContext,
} from "@workspace/db/queries/conversations";
import { type MessageRow, toMessage } from "@workspace/db/queries/messages";

// Rows to the contract's shapes. Pure.

const iso = (date: Date | null): string | null => date?.toISOString() ?? null;

export const toConversation = (
  view: ConversationView,
  userId: UserId
): Conversation => ({
  archived: view.archivedAt !== null,
  context: toChatContext({
    id: view.contextId,
    type: view.contextType,
  } as StoredContext),
  contextLocked: view.contextLockedAt !== null,
  createdAt: view.createdAt.toISOString(),
  defaultTarget: view.defaultTarget,
  id: view.id,
  lastMessageAt: iso(view.lastMessageAt),
  mode: view.mode,
  // Only views the caller can read reach here, so there is a permission.
  myPermission: view.myPermission ?? "viewer",
  myState: {
    activeLeafId: view.activeLeafId,
    followingUserId: view.followingUserId,
    lastReadAt: iso(view.lastReadAt),
    userId,
  },
  ownerId: view.ownerId,
  pinned: view.pinnedAt !== null,
  title: view.title,
  updatedAt: view.updatedAt.toISOString(),
  visibility: view.visibility,
});

/**
 * Messages this build can read. A row stored in a newer `partsVersion` (a
 * rolled-back deploy) is left out rather than failing the whole list.
 */
export const toMessages = (rows: readonly MessageRow[]): Message[] =>
  rows.flatMap((row) => {
    const message = toMessage(row);
    return message.ok ? [message.value] : [];
  });

export const toParticipantState = (row: {
  readonly activeLeafId: ParticipantState["activeLeafId"];
  readonly followingUserId: ParticipantState["followingUserId"];
  readonly lastReadAt: Date | null;
  readonly userId: UserId;
}): ParticipantState => ({
  activeLeafId: row.activeLeafId,
  followingUserId: row.followingUserId,
  lastReadAt: iso(row.lastReadAt),
  userId: row.userId,
});

export const toParticipant = (row: ParticipantRow): Participant => ({
  permission: row.permission,
  state: toParticipantState(row),
  user: {
    email: row.email,
    id: row.userId,
    image: row.image,
    name: row.name,
  },
});
