import type { UserId } from "@workspace/contract/schemas/common";
import type { Conversation } from "@workspace/contract/schemas/conversations";
import type { Tool, ToolApprovalStatus, ToolSet } from "ai";

import { UPDATE_MEMORY_TOOL, withMemoryInstructions } from "./prompt";
import type { MemorySnapshot } from "./store";

// Memory in a turn (D20): the file goes into the instructions and the
// `update_memory` tool joins the tool set, but only in a chat nobody else
// can see. A shared chat would leak the file to other readers, and let what
// they write end up in someone's memory, so it gets neither.

export interface ChatAudience {
  readonly ownerId: UserId;
  /** Everyone with per-user state in the chat (participant rows). */
  readonly participantIds: readonly UserId[];
  /** Who the turn is for: the run's creator. */
  readonly requesterId: UserId;
  readonly visibility: Conversation["visibility"];
}

/** True when only the requester can read the chat: their own, unshared, with nobody else in it. Pure. */
export const isPrivateChat = ({
  ownerId,
  participantIds,
  requesterId,
  visibility,
}: ChatAudience): boolean =>
  visibility === "private" &&
  ownerId === requesterId &&
  participantIds.every((id) => id === requesterId);

export interface TurnWithTools {
  readonly instructions?: string;
  readonly toolApproval?: Readonly<Record<string, ToolApprovalStatus>>;
  readonly tools?: ToolSet;
}

export interface TurnMemory {
  readonly maxChars: number;
  readonly snapshot: MemorySnapshot;
  readonly tool: Tool;
}

/**
 * The turn with the memory section appended to its instructions and the
 * memory tool added. The tool is ours, so it wins over an agent or MCP tool
 * that happens to share its name. Pure.
 */
export const withMemory = <T extends TurnWithTools>(
  turn: T,
  { maxChars, snapshot, tool }: TurnMemory
): T & Required<TurnWithTools> => ({
  ...turn,
  instructions: withMemoryInstructions(turn.instructions, {
    content: snapshot.content,
    maxChars,
    mode: snapshot.mode,
  }),
  toolApproval: {
    ...turn.toolApproval,
    [UPDATE_MEMORY_TOOL]:
      snapshot.mode === "propose" ? "user-approval" : "not-applicable",
  },
  tools: { ...turn.tools, [UPDATE_MEMORY_TOOL]: tool },
});
