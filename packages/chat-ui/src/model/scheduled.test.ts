import type { MessagePart } from "@workspace/contract/schemas/message-parts";
import { describe, expect, it } from "vitest";

import { quietRuns, reportOf, scheduledTaskOf } from "./scheduled";

const sent: MessagePart = {
  data: { scheduleId: null, title: "Inbox check" },
  name: "scheduled-task",
  type: "data",
};
const report = (outcome: string): MessagePart => ({
  approval: { state: "not-required" },
  input: { outcome },
  toolCallId: "c1",
  toolName: "report_outcome",
  type: "tool-call",
});
const text = (value: string): MessagePart => ({ text: value, type: "text" });

describe("scheduled runs in the transcript", () => {
  it("reads the schedule that sent a message, and what the answer reported", () => {
    expect(scheduledTaskOf([sent, text("Check")])).toEqual({
      scheduleId: null,
      title: "Inbox check",
    });
    expect(scheduledTaskOf([text("Hi")])).toBeNull();
    expect(reportOf([text("x"), report("needs_attention")])?.outcome).toBe(
      "needs_attention"
    );
  });

  it("folds only quiet scheduled runs", () => {
    const messages = [
      { id: "u1", parentId: null, parts: [sent, text("Check")], role: "user" },
      {
        id: "a1",
        parentId: "u1",
        parts: [report("no_update")],
        role: "assistant",
      },
      { id: "u2", parentId: "a1", parts: [sent, text("Check")], role: "user" },
      {
        id: "a2",
        parentId: "u2",
        parts: [text("New mail"), report("update")],
        role: "assistant",
      },
      { id: "u3", parentId: "a2", parts: [text("Thanks")], role: "user" },
    ] as const;
    expect([...quietRuns(messages)]).toEqual([["u1", "a1"]]);
  });
});
