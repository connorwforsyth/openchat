import type { RunId } from "@workspace/contract/schemas/common";
import type { Db } from "@workspace/db/client";
import { getDotByConversation } from "@workspace/db/queries/dots";
import { getRun } from "@workspace/db/queries/runs";
import type { ToolSet } from "ai";

import type { Turn, TurnResolver } from "../runs/turn";
import { isDotRunKey, unattendedApproval } from "./policy";

// A Dot's runs are unattended (172): this wraps the turn resolver so a run a
// Dot started gets the Dot's standing instructions, and its `ask` tools are
// either auto-approved by the Dot or withheld. A withheld tool is answered
// with the refusal as a tool error (the same path plan mode uses, 131), so
// the run never pauses waiting for someone who isn't there.

export interface DotPolicy {
  readonly autoApproveTools: readonly string[];
  readonly instructions: string;
  readonly name: string;
}

/** The pure half: a resolved turn under a Dot's policy. */
export const dotTurn = (turn: Turn, policy: DotPolicy): Turn => {
  const { refused, toolApproval } = unattendedApproval(
    turn.toolApproval ?? {},
    policy.autoApproveTools
  );
  const tools: ToolSet = {};
  for (const [name, tool] of Object.entries(turn.tools ?? {})) {
    if (!(name in refused)) {
      tools[name] = tool;
    }
  }
  const refusedNames = Object.keys(refused);
  const sections = [
    turn.instructions,
    `You are "${policy.name}", an always-on agent (a Dot). You run on a schedule with nobody watching: never ask the user a question or wait for a reply; do the task and report the result in this chat.`,
    policy.instructions.trim() === ""
      ? undefined
      : `Standing instructions from the owner:\n${policy.instructions.trim()}`,
    refusedNames.length > 0
      ? `These tools need a person's approval, so they are unavailable in unattended runs: ${refusedNames.join(", ")}.`
      : undefined,
  ].filter((section): section is string => Boolean(section));
  return {
    ...turn,
    instructions: sections.join("\n\n"),
    toolApproval,
    tools: Object.keys(tools).length > 0 ? tools : undefined,
    unavailableTools: { ...turn.unavailableTools, ...refused },
  };
};

/** Looks up whether a Dot started the run. A port, so tests can fake it. */
export type DotPolicyLookup = (runId: RunId) => Promise<DotPolicy | null>;

export const dbDotPolicy =
  (db: Db): DotPolicyLookup =>
  async (runId) => {
    const row = await getRun(db, runId);
    if (!(row.ok && isDotRunKey(row.value.idempotencyKey))) {
      return null;
    }
    const dot = await getDotByConversation(db, row.value.conversationId);
    return dot
      ? {
          autoApproveTools: dot.autoApproveTools,
          instructions: dot.instructions,
          name: dot.name,
        }
      : null;
  };

export const withDotPolicy =
  (resolveTurn: TurnResolver, lookup: DotPolicyLookup): TurnResolver =>
  async (run, options) => {
    const turn = await resolveTurn(run, options);
    if (!turn.ok) {
      return turn;
    }
    const policy = await lookup(run.runId);
    return policy ? { ...turn, value: dotTurn(turn.value, policy) } : turn;
  };
