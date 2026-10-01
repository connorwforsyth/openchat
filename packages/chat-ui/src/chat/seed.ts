import type { ConversationId } from "@workspace/contract/schemas/common";
import type { BranchPath } from "@workspace/contract/schemas/messages";

// What a server that renders the chat can hand the screen before the
// browser has asked (ticket 103). No client directive: the server reads the
// same inputs, so its answers land under the keys the screen's queries use.

/** The queued and running runs the screen follows, newest first. */
export const activeRunsInput = (conversationId: ConversationId) =>
  ({ active: true, conversationId, limit: 5 }) as const;

/**
 * The stored branch the server already read for the chat being opened,
 * `null` when it couldn't (not found, or no answer). A promise, so the page
 * streams: only the conversation waits for it, never the composer (D27).
 */
export type SeededBranch = Promise<{ readonly path: BranchPath } | null>;
