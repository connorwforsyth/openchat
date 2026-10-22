import { userAda } from "@workspace/contract/fixtures";
import { describe, expect, it } from "vitest";

import { candidateKey, fileCandidate, mentionCandidates } from "./mentions";

describe("mentionCandidates", () => {
  it("lists people with their email as the hint", () => {
    expect(mentionCandidates([userAda])).toEqual([
      {
        description: "ada@example.test",
        id: userAda.id,
        kind: "user",
        label: "Ada",
      },
    ]);
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

  it("lists files after people, keyed by path", () => {
    const candidates = mentionCandidates([userAda], ["a.ts"]);
    expect(candidates.map(candidateKey)).toEqual([
      `user:${userAda.id}`,
      "file:a.ts",
    ]);
  });
});
