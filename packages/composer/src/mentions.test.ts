import { agentItem, userAda } from "@workspace/contract/fixtures";
import { describe, expect, it } from "vitest";

import { mentionCandidates } from "./mentions";

describe("mentionCandidates", () => {
  it("lists agents then people, with a hint each", () => {
    expect(mentionCandidates([agentItem], [userAda])).toEqual([
      {
        description: "Reviews diffs hunk by hunk.",
        id: agentItem.id,
        kind: "agent",
        label: "Reviewer",
      },
      {
        description: "ada@example.test",
        id: userAda.id,
        kind: "user",
        label: "Ada",
      },
    ]);
  });

  it("leaves out an empty hint", () => {
    const [candidate] = mentionCandidates(
      [{ ...agentItem, description: "" }],
      []
    );
    expect(candidate?.description).toBeUndefined();
  });
});
