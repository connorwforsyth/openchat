import type { RunExecutor } from "@workspace/ai/ports/run-executor";
import type {
  ConversationId,
  UserId,
} from "@workspace/contract/schemas/common";
import type { Db } from "@workspace/db/client";
import { getDotByConversation } from "@workspace/db/queries/dots";
import { listActiveRuns } from "@workspace/db/queries/runs";
import type { AsyncResult } from "@workspace/shared/result";
import type { Tool } from "ai";
import type { Turn, TurnResolver } from "../runs/turn";
import type {
  ComputerHolder,
  ComputerPowerAction,
  ComputerView,
} from "./computer-view";

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

/** The desktop side, bound by the shell from `@workspace/sandbox`. A port. */
export interface DotComputers {
  /** Wipes the computer and its files, then starts a fresh one. */
  readonly reset: (
    conversationId: ConversationId
  ) => AsyncResult<ComputerView, unknown>;
  /** Restarts the computer, keeping its files; starts it if it's stopped. */
  readonly restart: (
    conversationId: ConversationId
  ) => AsyncResult<ComputerView, unknown>;
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

export interface PowerCycleDeps {
  readonly computers: DotComputers;
  readonly db: Db;
  readonly executor: Pick<RunExecutor, "cancel">;
}

/**
 * Stops the conversation's runs as Stop would, then restarts or resets its
 * computer, so no turn acts on a computer going away under it. The newest
 * run goes first: stopping the one being written first would start the
 * queued turn behind it. A run that ended meanwhile is already stopped.
 */
export const powerCycleComputer = async (
  { computers, db, executor }: PowerCycleDeps,
  conversationId: ConversationId,
  action: ComputerPowerAction,
  by: UserId
): AsyncResult<ComputerView, unknown> => {
  const active = await listActiveRuns(db, conversationId);
  for (const run of [...active].reverse()) {
    // biome-ignore lint/performance/noAwaitInLoops: each stop settles before the run behind it can start.
    await executor.cancel(run.id, by);
  }
  return computers[action](conversationId);
};

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
