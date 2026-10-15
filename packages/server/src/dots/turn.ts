import type { RunId } from "@workspace/contract/schemas/common";
import type { Db } from "@workspace/db/client";
import { getDotByConversation } from "@workspace/db/queries/dots";
import { getRun } from "@workspace/db/queries/runs";
import { err, ok } from "@workspace/shared/result";
import type { Tool, ToolApprovalStatus, ToolSet } from "ai";

import type { Turn, TurnResolver } from "../runs/turn";
import {
  type DotIdentity,
  dotPersona,
  isDotRunKey,
  unattendedApproval,
} from "./policy";
import {
  type DotSchedulesPort,
  dotScheduleTools,
  MANAGE_SCHEDULES_TOOL,
  SCHEDULE_TASK_TOOL,
} from "./schedule-tool";
import {
  addDotSchedule,
  editDotSchedule,
  ownerActor,
  scheduleDotsListFor,
} from "./service";

// Every turn in a Dot's chat is the Dot talking (172): it gets the Dot's
// persona, standing instructions and rules, and the tools to schedule its
// own work. A run the Dot started itself is unattended on top of that: its
// `ask` tools are either auto-approved by the Dot or withheld. A withheld
// tool is answered with the refusal as a tool error (the same path plan mode
// uses, 131), so the run never pauses waiting for someone who isn't there.

export interface DotPolicy extends DotIdentity {
  readonly autoApproveTools: readonly string[];
  /** `schedule_task` and `manage_scheduled_tasks`, bound to this Dot. */
  readonly tools?: Readonly<Record<string, Tool>>;
  /** The Dot started the run (a schedule or "Run now"): nobody is watching. */
  readonly unattended: boolean;
}

/** Adding work asks the owner; listing and pausing never does. */
const SCHEDULE_APPROVAL: Readonly<Record<string, ToolApprovalStatus>> = {
  [MANAGE_SCHEDULES_TOOL]: "not-applicable",
  [SCHEDULE_TASK_TOOL]: "user-approval",
};

/** The pure half: a resolved turn under a Dot's policy. */
export const dotTurn = (turn: Turn, policy: DotPolicy): Turn => {
  const withTools: Turn = policy.tools
    ? {
        ...turn,
        toolApproval: { ...turn.toolApproval, ...SCHEDULE_APPROVAL },
        tools: { ...turn.tools, ...policy.tools },
      }
    : turn;
  if (!policy.unattended) {
    return {
      ...withTools,
      instructions: [withTools.instructions, dotPersona(policy)]
        .filter(Boolean)
        .join("\n\n"),
    };
  }
  const { refused, toolApproval } = unattendedApproval(
    withTools.toolApproval ?? {},
    policy.autoApproveTools
  );
  const tools: ToolSet = {};
  for (const [name, tool] of Object.entries(withTools.tools ?? {})) {
    if (!(name in refused)) {
      tools[name] = tool;
    }
  }
  const refusedNames = Object.keys(refused);
  const sections = [
    withTools.instructions,
    `You are "${policy.name}", an always-on agent (a Dot). You run on a schedule with nobody watching: never ask the user a question or wait for a reply; do the task and report the result in this chat.`,
    policy.instructions.trim() === ""
      ? undefined
      : `Standing instructions from the owner:\n${policy.instructions.trim()}`,
    policy.rules.trim() === ""
      ? undefined
      : `The owner's rules on when to act and when to ask:\n${policy.rules.trim()}`,
    refusedNames.length > 0
      ? `These tools need a person's approval, so they are unavailable in unattended runs: ${refusedNames.join(", ")}.`
      : undefined,
  ].filter((section): section is string => Boolean(section));
  return {
    ...withTools,
    instructions: sections.join("\n\n"),
    toolApproval,
    tools: Object.keys(tools).length > 0 ? tools : undefined,
    unavailableTools: { ...withTools.unavailableTools, ...refused },
  };
};

/** Looks up whether the run is in a Dot's chat. A port, so tests can fake it. */
export type DotPolicyLookup = (runId: RunId) => Promise<DotPolicy | null>;

export const dbDotPolicy =
  (db: Db, now: () => Date = () => new Date()): DotPolicyLookup =>
  async (runId) => {
    const row = await getRun(db, runId);
    if (!row.ok) {
      return null;
    }
    const dot = await getDotByConversation(db, row.value.conversationId);
    if (!dot) {
      return null;
    }
    const deps = { db, now };
    const port: DotSchedulesPort = {
      create: async (input) => {
        const actor = await ownerActor(db, dot.ownerId);
        const created = await addDotSchedule(deps, actor, {
          ...input,
          dotId: dot.id,
          enabled: true,
        });
        return created.ok
          ? created
          : err(
              "message" in created.error
                ? created.error.message
                : "The schedule couldn't be created."
            );
      },
      list: () => scheduleDotsListFor(db, dot.id),
      setEnabled: async (id, enabled) => {
        const actor = await ownerActor(db, dot.ownerId);
        const changed = await editDotSchedule(deps, actor, { enabled, id });
        return changed.ok
          ? ok(changed.value)
          : err("The schedule couldn't be changed.");
      },
    };
    return {
      autoApproveTools: dot.autoApproveTools,
      handle: dot.handle,
      instructions: dot.instructions,
      name: dot.name,
      rules: dot.rules,
      tools: dotScheduleTools(port),
      unattended: isDotRunKey(row.value.idempotencyKey),
    };
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
