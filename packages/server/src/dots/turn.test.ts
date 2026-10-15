import { asSchema, tool } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import type { Turn } from "../runs/turn";
import { UNATTENDED_REFUSAL } from "./policy";
import {
  MANAGE_SCHEDULES_TOOL,
  manageSchedulesInputSchema,
  SCHEDULE_TASK_TOOL,
  scheduleTaskInputSchema,
} from "./schedule-tool";
import { type DotPolicy, dotTurn } from "./turn";

// The pure half of a Dot's turn (172): persona and schedule tools in its
// chat, approval on adding work, and the unattended refusals on top.

const noop = tool({ execute: () => "ok", inputSchema: z.object({}) });

const turn: Turn = {
  agent: null,
  instructions: "Base.",
  model: new MockLanguageModelV4(),
  paidBy: null,
  resolvedModel: "test:model" as Turn["resolvedModel"],
};

const policy = (
  unattended: boolean,
  autoApprove: string[] = []
): DotPolicy => ({
  autoApproveTools: autoApprove,
  handle: "pip",
  instructions: "Inbox zero.",
  name: "Pip",
  rules: "",
  tools: { [MANAGE_SCHEDULES_TOOL]: noop, [SCHEDULE_TASK_TOOL]: noop },
  unattended,
});

describe("dotTurn", () => {
  it("gives the attended chat the persona and asks before adding a schedule", () => {
    const out = dotTurn(turn, policy(false));
    expect(out.instructions).toContain("Base.");
    expect(out.instructions).toContain("You are Pip (@pip)");
    expect(out.toolApproval).toEqual({
      [MANAGE_SCHEDULES_TOOL]: "not-applicable",
      [SCHEDULE_TASK_TOOL]: "user-approval",
    });
    expect(Object.keys(out.tools ?? {}).sort()).toEqual([
      MANAGE_SCHEDULES_TOOL,
      SCHEDULE_TASK_TOOL,
    ]);
    expect(out.unavailableTools).toBeUndefined();
  });

  it("withholds schedule_task unattended, unless the Dot auto-approves it", () => {
    const refused = dotTurn(turn, policy(true));
    expect(Object.keys(refused.tools ?? {})).toEqual([MANAGE_SCHEDULES_TOOL]);
    expect(refused.unavailableTools).toEqual({
      [SCHEDULE_TASK_TOOL]: UNATTENDED_REFUSAL,
    });
    expect(refused.instructions).toContain("nobody watching");

    const allowed = dotTurn(turn, policy(true, [SCHEDULE_TASK_TOOL]));
    expect(allowed.toolApproval?.[SCHEDULE_TASK_TOOL]).toBe("not-applicable");
    expect(Object.keys(allowed.unavailableTools ?? {})).toEqual([]);
  });
});

describe("schedule tools' input schemas", () => {
  it("are objects at the root, as providers require", () => {
    expect(asSchema(manageSchedulesInputSchema).jsonSchema).toMatchObject({
      type: "object",
    });
    expect(asSchema(scheduleTaskInputSchema).jsonSchema).toMatchObject({
      type: "object",
    });
  });
});
