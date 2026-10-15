import { describe, expect, it } from "vitest";

import { guidePointer, kindOfSource, kindPrompts } from "./artifact-guides";
import { composeInstructions } from "./compose";

const kinds = [
  { source: "kinds/document", text: "Write documents like this." },
  { source: "kinds/site", text: "A long site guide.\n\nWith components." },
];

describe("kindPrompts", () => {
  it("keeps every kind whole when the guide tool isn't offered", () => {
    expect(kindPrompts(kinds, false)).toEqual(kinds);
  });

  it("shrinks every kind but Document to one line when it is", () => {
    expect(kindPrompts(kinds, true)).toEqual([
      kinds[0],
      { source: "kinds/site", text: guidePointer("site") },
    ]);
    expect(guidePointer("site")).not.toContain("\n");
    expect(guidePointer("site")).toContain(
      'load_artifact_guide` with type "site"'
    );
  });

  it("reads the kind from a prompt file's source", () => {
    expect(kindOfSource("kinds/site")).toBe("site");
    expect(kindOfSource("fragments/memory.md")).toBeUndefined();
  });
});

describe("composeInstructions with artifact kinds", () => {
  it("gives the full text without the guide tool", () => {
    const composed = composeInstructions({ kinds });
    expect(composed.text).toBe(
      "Write documents like this.\n\nA long site guide.\n\nWith components."
    );
  });

  it("points at the guide tool when the turn has it", () => {
    const composed = composeInstructions({ kindGuidesOnDemand: true, kinds });
    expect(composed.sections).toEqual([
      {
        layer: "kinds",
        source: "kinds/document",
        text: "Write documents like this.",
      },
      { layer: "kinds", source: "kinds/site", text: guidePointer("site") },
    ]);
    expect(composed.text).not.toContain("A long site guide");
  });
});
