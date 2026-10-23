import { fixtureId } from "@workspace/contract/fixtures";
import { describe, expect, it } from "vitest";

import {
  BLOCKS,
  type BlockId,
  blockMenuItems,
  blockMenuStage,
  type LinkTarget,
} from "./blocks";

const labels: Record<BlockId, string> = {
  artifactLink: "Link to artifact",
  blockquote: "Quote",
  bulletList: "Bulleted list",
  codeBlock: "Code block",
  divider: "Divider",
  heading1: "Heading 1",
  heading2: "Heading 2",
  heading3: "Heading 3",
  image: "Image",
  orderedList: "Numbered list",
  paragraph: "Text",
  table: "Table",
  taskList: "To-do list",
};

const self = fixtureId("artifact", 1);
const targets: LinkTarget[] = [
  { id: self, kind: "document", title: "Trip brief" },
  { id: fixtureId("artifact", 2), kind: "document", title: "Packing list" },
  { id: fixtureId("artifact", 3), kind: "code", title: "Route planner" },
];

const ids = (query: string, from: readonly LinkTarget[] = targets) =>
  blockMenuItems(query, labels, from, self).map((item) =>
    item.kind === "block" ? item.id : item.artifact.title
  );

describe("blockMenuItems", () => {
  it("lists every block, in order, for an empty query", () => {
    expect(ids("")).toEqual(BLOCKS.map((block) => block.id));
  });

  it("matches the start of a label or of one of its words, any case", () => {
    expect(ids("head")).toEqual(["heading1", "heading2", "heading3"]);
    expect(ids("LIST")).toEqual(["bulletList", "orderedList", "taskList"]);
  });

  it("matches a keyword", () => {
    expect(ids("h2")).toEqual(["heading2"]);
    expect(ids("todo")).toEqual(["taskList"]);
    expect(ids("checkbox")).toEqual(["taskList"]);
    expect(ids("---")).toEqual(["divider"]);
    expect(ids("hr")).toEqual(["divider"]);
  });

  it("lists nothing when nothing matches", () => {
    expect(ids("zebra")).toEqual([]);
  });

  it("offers a link only when there's another artifact to link to", () => {
    expect(ids("link")).toEqual(["artifactLink"]);
    expect(ids("link", [])).toEqual([]);
    expect(ids("link", targets.slice(0, 1))).toEqual([]);
  });

  it("lists the other artifacts in the link stage, filtered by title", () => {
    expect(ids("link:")).toEqual(["Packing list", "Route planner"]);
    expect(ids("link:PLAN")).toEqual(["Route planner"]);
    expect(ids("link:trip")).toEqual([]);
  });
});

describe("blockMenuStage", () => {
  it("is the link stage after `link:`, with what follows as the query", () => {
    expect(blockMenuStage("link:pack")).toEqual({
      query: "pack",
      stage: "link",
    });
    expect(blockMenuStage("link")).toEqual({ query: "link", stage: "blocks" });
  });
});
