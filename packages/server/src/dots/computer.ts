import type { ConversationId } from "@workspace/contract/schemas/common";
import type { Db } from "@workspace/db/client";
import { getDotByConversation } from "@workspace/db/queries/dots";
import type { AsyncResult } from "@workspace/shared/result";
import type { Tool } from "ai";
import { z } from "zod";

import type { Turn, TurnResolver } from "../runs/turn";

// A Dot's own computer (172). `@workspace/sandbox` builds the desktop and the
// `computer` tool (it depends on this package, so the shell binds it in);
// what stays here is the policy: every turn in a Dot's conversation, whether
// scheduled or the owner chatting, gets the tool, and it never asks for
// approval. The computer is the Dot's alone, so acting on it is the point;
// the owner keeps the brakes (watch live, take over), and the unattended
// policy (`withDotPolicy`, applied over this) still governs anything that
// does ask.

export const COMPUTER_TOOL = "computer";

export const COMPUTER_INSTRUCTIONS =
  "You have your own computer: a Linux desktop with Chromium that the owner can watch live. Use the `computer` tool to see and drive it: `open_browser` (with a url) starts the browser, `screenshot` looks, then click, type, key and scroll at the pixel coordinates you see. Every action returns a fresh screenshot; check it before the next step, and report what you actually saw. If the owner has taken control, stop acting on the computer until they give it back.";

export const computerHolderSchema = z.enum(["user", "agent"]);
export type ComputerHolder = z.infer<typeof computerHolderSchema>;

export const computerViewSchema = z.object({
  /** Who drives it now: the Dot (`agent`) or the person watching (`user`). */
  holder: computerHolderSchema,
  /** noVNC on the sandbox preview origin (D24), view-only unless `view_only=0`. */
  url: z.url(),
});
export type ComputerView = z.infer<typeof computerViewSchema>;

/** The desktop side, bound by the shell from `@workspace/sandbox`. A port. */
export interface DotComputers {
  readonly setControl: (
    conversationId: ConversationId,
    holder: ComputerHolder
  ) => AsyncResult<ComputerView, unknown>;
  readonly tools: (
    conversationId: ConversationId
  ) => Readonly<Record<string, Tool>>;
  readonly view: (
    conversationId: ConversationId
  ) => AsyncResult<ComputerView, unknown>;
}

/** Whether a conversation is a Dot's. A port, so tests fake it. */
export type DotConversationCheck = (
  conversationId: ConversationId
) => Promise<boolean>;

export const dbDotConversation =
  (db: Db): DotConversationCheck =>
  async (conversationId) =>
    (await getDotByConversation(db, conversationId)) !== null;

/** The pure half: a turn with the computer added, never asking. */
export const computerTurn = (
  turn: Turn,
  tools: Readonly<Record<string, Tool>>
): Turn => {
  const approvals = Object.fromEntries(
    Object.entries(turn.toolApproval ?? {}).filter(([name]) => !(name in tools))
  );
  return {
    ...turn,
    // Ahead of the turn's own, whose tail changes per turn (prompt cache).
    instructions: [COMPUTER_INSTRUCTIONS, turn.instructions]
      .filter((section): section is string => Boolean(section))
      .join("\n\n"),
    toolApproval: approvals,
    tools: { ...turn.tools, ...tools },
  };
};

export const withDotComputer =
  (
    resolveTurn: TurnResolver,
    computers: DotComputers | undefined,
    isDotConversation: DotConversationCheck
  ): TurnResolver =>
  async (run, options) => {
    const turn = await resolveTurn(run, options);
    if (!(turn.ok && computers)) {
      return turn;
    }
    return (await isDotConversation(run.conversationId))
      ? {
          ...turn,
          value: computerTurn(turn.value, computers.tools(run.conversationId)),
        }
      : turn;
  };
