import type { MessagePart } from "@workspace/contract/schemas/message-parts";
import { describe, expect, it } from "vitest";

import {
  SKILLS_DATA,
  skillsDataPart,
  skillUsesOf,
  withoutSkillsData,
} from "./skills";

const id = "11111111-1111-4111-8111-111111111111";
const versionId = "22222222-2222-4222-8222-222222222222";

describe("skills data parts", () => {
  it("round-trip through a message's parts, once per skill", () => {
    const part = skillsDataPart([
      { id: id as never, name: "Release notes", versionId: versionId as never },
    ]);
    expect(part).toEqual({
      data: { skills: [{ id, name: "Release notes", versionId }] },
      name: SKILLS_DATA,
      type: "data",
    });
    const parts: MessagePart[] = [
      { text: "hi", type: "text" },
      part,
      part,
      { data: { skills: "nope" }, name: SKILLS_DATA, type: "data" },
    ];
    expect(skillUsesOf(parts)).toEqual([
      { id, name: "Release notes", versionId },
    ]);
  });

  it("drops a sent skills part and keeps everything else", () => {
    const parts: MessagePart[] = [
      { text: "hi", type: "text" },
      { data: { skills: [] }, name: SKILLS_DATA, type: "data" },
      { data: { path: "a.txt" }, name: "workspace-file", type: "data" },
    ];
    expect(withoutSkillsData(parts)).toEqual([parts[0], parts[2]]);
  });
});
