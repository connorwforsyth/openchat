import type { LibraryItemId } from "@workspace/contract/schemas/common";
import { describe, expect, it } from "vitest";

import {
  answeringAgent,
  CHIPS_DATA,
  chipsOf,
  type PlacedChip,
  replaceChips,
  requestedArtifacts,
  segmentText,
} from "./chips";

const RESEARCHER = "00000000-0000-4000-8000-000000000001" as LibraryItemId;
const WRITER = "00000000-0000-4000-8000-000000000002" as LibraryItemId;

const text = "ask @Researcher then @Writer for @Slides";
const chips: PlacedChip[] = [
  { end: 15, id: RESEARCHER, kind: "agent", label: "Researcher", start: 4 },
  { end: 28, id: WRITER, kind: "agent", label: "Writer", start: 21 },
  {
    artifact: "presentation",
    end: 40,
    kind: "artifact",
    label: "Slides",
    start: 33,
  },
];

describe("chipsOf", () => {
  it("reads the chips part and ignores malformed or other parts", () => {
    expect(
      chipsOf([
        { text, type: "text" },
        { data: { chips }, name: CHIPS_DATA, type: "data" },
        {
          data: { chips: [{ kind: "agent" }] },
          name: CHIPS_DATA,
          type: "data",
        },
        { data: { chips }, name: "skills", type: "data" },
      ] as never)
    ).toEqual(chips);
  });
});

describe("answeringAgent", () => {
  it("is the last agent chip", () => {
    expect(answeringAgent(chips)?.id).toBe(WRITER);
  });

  it("is undefined without an agent chip", () => {
    expect(answeringAgent(chips.slice(2))).toBeUndefined();
  });
});

describe("requestedArtifacts", () => {
  it("lists each kind asked for once", () => {
    expect(
      requestedArtifacts([...chips, { ...chips[2], start: 0 } as PlacedChip])
    ).toEqual(["presentation"]);
  });
});

describe("segmentText", () => {
  it("cuts the text into plain runs and chips", () => {
    expect(segmentText(text, chips)).toEqual([
      { kind: "text", text: "ask " },
      { chip: chips[0], kind: "chip" },
      { kind: "text", text: " then " },
      { chip: chips[1], kind: "chip" },
      { kind: "text", text: " for " },
      { chip: chips[2], kind: "chip" },
    ]);
  });

  it("leaves a chip that no longer matches its place as text", () => {
    expect(segmentText("ask @Someone", [chips[0] as PlacedChip])).toEqual([
      { kind: "text", text: "ask @Someone" },
    ]);
  });
});

describe("replaceChips", () => {
  it("moves the chips still in edited text and drops the ones taken out", () => {
    expect(replaceChips("please @Writer, make @Slides", chips)).toEqual([
      { ...chips[1], end: 14, start: 7 },
      { ...chips[2], end: 28, start: 21 },
    ]);
  });
});
