import { describe, expect, it } from "vitest";

import { skillRevision } from "./skill-authoring";

describe("skillRevision", () => {
  it("counts the skill-tool results that came back, not refusals by the person or other tools", () => {
    const result = (toolName: string, status: "success" | "denied") => ({
      output:
        status === "success"
          ? { status, value: { status: "saved" } }
          : { decision: { decision: "reject" as const }, status },
      toolCallId: `c-${toolName}-${status}`,
      toolName,
      type: "tool-result" as const,
    });
    expect(
      skillRevision([
        {
          parts: [
            result("create_skill", "success"),
            result("publish_skill", "denied"),
            result("bash", "success"),
          ],
        },
        { parts: [result("publish_skill", "success")] },
      ])
    ).toBe(2);
    expect(skillRevision([])).toBe(0);
  });
});
