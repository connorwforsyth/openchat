import {
  MANAGE_SCHEDULES_TOOL,
  REPORT_TOOL,
  SCHEDULE_TASK_TOOL,
} from "@workspace/ai/schedules/tool";
import type { DotScheduleId, RunId } from "@workspace/contract/schemas/common";
import type { Db } from "@workspace/db/client";
import {
  getDotByConversation,
  getScheduleById,
} from "@workspace/db/queries/dots";
import { getRun } from "@workspace/db/queries/runs";
import { err, ok } from "@workspace/shared/result";
import type { Tool, ToolApprovalStatus, ToolSet } from "ai";
import type { ConversationAccess } from "../context";
import { planTurn } from "../runs/plan-mode";
import type { Turn, TurnResolver } from "../runs/turn";
import {
  type DotIdentity,
  dotPersona,
  isDotRunKey,
  scheduleIdOfKey,
  unattendedApproval,
} from "./policy";
import { REPORT_INSTRUCTIONS, reportTool } from "./report-tool";
import type { ScheduleLimitsConfig } from "./schedule-policy";
import { type DotSchedulesPort, dotScheduleTools } from "./schedule-tool";
import {
  createSchedule,
  ownerActor,
  pauseSchedule,
  resumeSchedule,
  type ScheduleEditDeps,
} from "./schedules";
import { scheduleDotsListFor } from "./service";

// Every turn in a Dot's chat is the Dot talking (172): it gets the Dot's
// persona, standing instructions and rules, and the tools to schedule its
// own work. A run the Dot started itself is unattended on top of that: its
// `ask` tools are either auto-approved by the Dot or withheld. A withheld
// tool is answered with the refusal as a tool error (the same path plan mode
// uses, 131), so the run never pauses waiting for someone who isn't there.

/**
 * The guards on a run nobody watches (175): a step and token budget, the
 * `report` tool the loop stops after, and, for a schedule on an ordinary
 * chat, no tools that write.
 */
export interface UnattendedRun {
  readonly budget: { readonly steps: number; readonly tokens: number };
  readonly readOnly: boolean;
}

export interface DotPolicy extends DotIdentity {
  readonly autoApproveTools: readonly string[];
  /** Set on an unattended run; without it (older tests) only the refusals apply. */
  readonly run?: UnattendedRun;
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
      // Static first: the persona leads, so the turn's own changing tail
      // (mentions, memory) is all a prompt cache has to read again.
      instructions: [dotPersona(policy), withTools.instructions]
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
  // Static first, as above; the turn's own instructions end it.
  const sections = [
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
    withTools.instructions,
  ].filter((section): section is string => Boolean(section));
  const unattended: Turn = {
    ...withTools,
    instructions: sections.join("\n\n"),
    toolApproval,
    tools: Object.keys(tools).length > 0 ? tools : undefined,
    unavailableTools: { ...withTools.unavailableTools, ...refused },
  };
  return policy.run ? guardedTurn(unattended, policy.run) : unattended;
};

/**
 * An unattended turn under its guards: read-only when asked (plan mode's
 * filter, 106), the `report` tool with the loop stopping after it, and the
 * budget. Pure.
 */
export const guardedTurn = (turn: Turn, run: UnattendedRun): Turn => {
  const filtered = run.readOnly ? planTurn(turn) : turn;
  return {
    ...filtered,
    budget: run.budget,
    instructions: [filtered.instructions, REPORT_INSTRUCTIONS]
      .filter(Boolean)
      .join("\n\n"),
    stopAfterTools: [REPORT_TOOL],
    toolApproval: { ...filtered.toolApproval, [REPORT_TOOL]: "not-applicable" },
    tools: { ...filtered.tools, [REPORT_TOOL]: reportTool() },
  };
};

/** A schedule's run on an ordinary chat (173): unattended, with no Dot persona. */
export interface ChatSchedulePolicy {
  readonly autoApproveTools: readonly string[];
  readonly run: UnattendedRun;
  readonly title: string;
}

/** The pure half for an ordinary chat's scheduled run. */
export const chatScheduleTurn = (
  turn: Turn,
  policy: ChatSchedulePolicy
): Turn => {
  const { refused, toolApproval } = unattendedApproval(
    turn.toolApproval ?? {},
    policy.autoApproveTools
  );
  const tools: ToolSet = {};
  for (const [name, each] of Object.entries(turn.tools ?? {})) {
    if (!(name in refused)) {
      tools[name] = each;
    }
  }
  return guardedTurn(
    {
      ...turn,
      instructions: [
        `This turn is the scheduled task "${policy.title}", running with nobody watching: never ask the user a question or wait for a reply; do the task and report the result in this chat.`,
        turn.instructions,
      ]
        .filter(Boolean)
        .join("\n\n"),
      toolApproval,
      tools: Object.keys(tools).length > 0 ? tools : undefined,
      unavailableTools: { ...turn.unavailableTools, ...refused },
    },
    policy.run
  );
};

export type TurnPolicy =
  | { readonly policy: DotPolicy; readonly type: "dot" }
  | { readonly policy: ChatSchedulePolicy; readonly type: "chat" };

export const policyTurn = (turn: Turn, policy: TurnPolicy): Turn =>
  policy.type === "dot"
    ? dotTurn(turn, policy.policy)
    : chatScheduleTurn(turn, policy.policy);

/** Looks up the run's Dot or schedule policy. A port, so tests can fake it. */
export type DotPolicyLookup = (runId: RunId) => Promise<TurnPolicy | null>;

export interface DotPolicyDeps {
  readonly access: ConversationAccess;
  readonly db: Db;
  readonly limits: ScheduleLimitsConfig;
  readonly now?: () => Date;
}

export const dbDotPolicy =
  (deps: DotPolicyDeps): DotPolicyLookup =>
  async (runId) => {
    const { db } = deps;
    const now = deps.now ?? (() => new Date());
    const row = await getRun(db, runId);
    if (!row.ok) {
      return null;
    }
    const key = row.value.idempotencyKey;
    const unattended = isDotRunKey(key);
    const scheduleId = scheduleIdOfKey(key);
    const schedule = scheduleId
      ? await getScheduleById(db, scheduleId as DotScheduleId)
      : null;
    const guards: UnattendedRun = {
      budget: {
        steps: deps.limits.runStepBudget,
        tokens: deps.limits.runTokenBudget,
      },
      readOnly: schedule?.readOnly ?? false,
    };
    const dot = await getDotByConversation(db, row.value.conversationId);
    if (!dot) {
      return unattended && schedule
        ? {
            policy: {
              autoApproveTools: schedule.autoApproveTools,
              run: guards,
              title: schedule.title,
            },
            type: "chat",
          }
        : null;
    }
    const scheduleDeps: ScheduleEditDeps = { ...deps, now };
    const port: DotSchedulesPort = {
      create: async (input) => {
        const actor = await ownerActor(db, dot.ownerId);
        const created = await createSchedule(scheduleDeps, actor, input);
        return created.ok
          ? created
          : err(
              "message" in created.error
                ? created.error.message
                : "The schedule couldn't be created."
            );
      },
      list: () => scheduleDotsListFor(db, dot.id),
      now,
      setEnabled: async (id, enabled) => {
        const actor = await ownerActor(db, dot.ownerId);
        const changed = enabled
          ? await resumeSchedule(scheduleDeps, actor, id)
          : await pauseSchedule(scheduleDeps, actor, id);
        return changed.ok
          ? ok(changed.value)
          : err("The schedule couldn't be changed.");
      },
    };
    return {
      policy: {
        autoApproveTools: [
          ...dot.autoApproveTools,
          ...(schedule?.autoApproveTools ?? []),
        ],
        handle: dot.handle,
        instructions: dot.instructions,
        name: dot.name,
        rules: dot.rules,
        run: unattended ? guards : undefined,
        tools: dotScheduleTools(port),
        unattended,
      },
      type: "dot",
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
    return policy ? { ...turn, value: policyTurn(turn.value, policy) } : turn;
  };
