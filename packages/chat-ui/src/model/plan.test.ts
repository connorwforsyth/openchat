import type { ArtifactId } from "@workspace/contract/schemas/common";
import type { Message } from "@workspace/contract/schemas/messages";
import type { UIMessage } from "ai";
import { describe, expect, it } from "vitest";

import { messageView } from "./parts";
import {
  approvedPlanIds,
  planApprovalMessage,
  planApprovalParts,
} from "./plan";

// Plan mode's parts in the chat (106).

const artifactId = "019a0000-0000-7000-8000-0000000000a1" as ArtifactId;
const versionId = "019a0000-0000-7000-8000-0000000000b1";
const plan = { artifactId, title: "Plan: Add a dark theme", versionId };

describe("the plan card's parts", () => {
  it("shows a plan data part as the plan card", () => {
    const view = messageView(
      [
        { text: "# Add a dark theme", type: "text" },
        { data: plan, name: "plan", type: "data" },
      ],
      new Map()
    );
    expect(view.blocks.map((block) => block.kind)).toEqual(["text", "plan"]);
    expect(view.blocks[1]).toMatchObject({ plan });
  });

  it("drops a malformed one", () => {
    const view = messageView(
      [{ data: { artifactId: "x" }, name: "plan", type: "data" }],
      new Map()
    );
    expect(view.blocks).toEqual([]);
  });

  it("shows an approval as its note", () => {
    const view = messageView(
      [
        { text: "Go ahead", type: "text" },
        {
          data: { artifactId, versionId },
          name: "plan-approval",
          type: "data",
        },
      ],
      new Map()
    );
    expect(view.blocks.map((block) => block.kind)).toEqual([
      "text",
      "plan-approval",
    ]);
  });
});

describe("approvedPlanIds", () => {
  it("collects the plans users approved on the branch", () => {
    const messages: Pick<Message, "parts" | "role">[] = [
      {
        parts: [{ data: plan, name: "plan", type: "data" }],
        role: "assistant",
      },
      {
        parts: [
          { text: "Go ahead", type: "text" },
          { data: { artifactId }, name: "plan-approval", type: "data" },
        ],
        role: "user",
      },
    ];
    expect([...approvedPlanIds(messages)]).toEqual([artifactId]);
    expect(approvedPlanIds(messages.slice(0, 1)).size).toBe(0);
  });
});

describe("approving", () => {
  it("sends the text and the approval, with edits only when there are some", () => {
    expect(planApprovalMessage("Go ahead", plan)).toEqual({
      parts: [
        { text: "Go ahead", type: "text" },
        { data: { artifactId }, type: "data-plan-approval" },
      ],
    });
    expect(planApprovalMessage("Go ahead", plan, "# Edited").parts[1]).toEqual({
      data: { artifactId, content: "# Edited" },
      type: "data-plan-approval",
    });
  });

  it("keeps the approval when the transport stores the message", () => {
    const message = {
      id: "m1",
      role: "user",
      ...planApprovalMessage("Go ahead", plan, "# Edited"),
    } as UIMessage;
    expect(planApprovalParts(message)).toEqual([
      {
        data: { artifactId, content: "# Edited" },
        name: "plan-approval",
        type: "data",
      },
    ]);
    expect(
      planApprovalParts({
        id: "m2",
        parts: [{ data: { nope: true }, type: "data-plan-approval" }],
        role: "user",
      } as UIMessage)
    ).toEqual([]);
  });
});
