import { agentItem, userAda } from "@workspace/contract/fixtures";
import { describe, expect, it } from "vitest";

import { candidateKey, fileCandidate, mentionCandidates } from "./mentions";

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

describe("fileCandidate", () => {
  it("names a file and hints at its folder", () => {
    expect(fileCandidate("src/lib/app.ts")).toEqual({
      description: "src/lib",
      kind: "file",
      label: "app.ts",
      path: "src/lib/app.ts",
    });
    expect(fileCandidate("README.md")).toEqual({
      kind: "file",
      label: "README.md",
      path: "README.md",
    });
    expect(fileCandidate("src/").label).toBe("src/");
  });

  it("lists files after agents and people, keyed by path", () => {
    const candidates = mentionCandidates([agentItem], [userAda], ["a.ts"]);
    expect(candidates.map(candidateKey)).toEqual([
      `agent:${agentItem.id}`,
      `user:${userAda.id}`,
      "file:a.ts",
    ]);
  });
});
