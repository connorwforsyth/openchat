import type { MessageId } from "@workspace/contract/schemas/common";
import { describe, expect, it } from "vitest";

import {
  activeFork,
  buildBranchPath,
  newestLeafUnder,
  siblingsOf,
  stepSibling,
  type TreeNode,
} from "./branch";

const id = (name: string) => name as MessageId;
const node = (
  name: string,
  parent: string | null,
  minute: number
): TreeNode => ({
  createdAt: new Date(Date.UTC(2026, 8, 27, 9, minute)).toISOString(),
  id: id(name),
  parentId: parent === null ? null : id(parent),
});

// u1 → a1 → u2 → a2
//            └─→ a2b (regenerated)
//      └─→ u2b (edited) → a3
const tree = [
  node("u1", null, 0),
  node("a1", "u1", 1),
  node("u2", "a1", 2),
  node("a2", "u2", 3),
  node("u2b", "a1", 4),
  node("a3", "u2b", 5),
  node("a2b", "u2", 6),
];

describe("siblingsOf", () => {
  it("lists siblings oldest first with the message's position", () => {
    expect(siblingsOf(tree, id("u2b"))).toEqual({
      index: 1,
      messageId: id("u2b"),
      siblingIds: [id("u2"), id("u2b")],
    });
    expect(siblingsOf(tree, id("u1"))?.siblingIds).toEqual([id("u1")]);
    expect(siblingsOf(tree, id("missing"))).toBeUndefined();
  });
});

describe("newestLeafUnder", () => {
  it("follows the newest child down to a leaf", () => {
    expect(newestLeafUnder(tree, id("u2"))).toBe(id("a2b"));
    expect(newestLeafUnder(tree, id("u2b"))).toBe(id("a3"));
    expect(newestLeafUnder(tree, id("a3"))).toBe(id("a3"));
  });
});

describe("buildBranchPath", () => {
  it("walks from the root to the leaf", () => {
    expect(buildBranchPath(tree, id("a2"))).toEqual(
      ["u1", "a1", "u2", "a2"].map(id)
    );
    expect(buildBranchPath(tree, id("a3"))).toEqual(
      ["u1", "a1", "u2b", "a3"].map(id)
    );
  });

  it("returns undefined for an unknown leaf or a cycle", () => {
    expect(buildBranchPath(tree, id("nope"))).toBeUndefined();
    const cyclic = [node("x", "y", 0), node("y", "x", 1)];
    expect(buildBranchPath(cyclic, id("x"))).toBeUndefined();
  });
});

describe("stepSibling and activeFork", () => {
  const first = {
    index: 0,
    messageId: id("u2"),
    siblingIds: [id("u2"), id("u2b")],
  };

  it("steps without wrapping", () => {
    expect(stepSibling(first, 1)).toBe(id("u2b"));
    expect(stepSibling(first, -1)).toBeNull();
  });

  it("picks the deepest message that has siblings", () => {
    const deeper = {
      index: 1,
      messageId: id("a2b"),
      siblingIds: [id("a2"), id("a2b")],
    };
    const single = { index: 0, messageId: id("u1"), siblingIds: [id("u1")] };
    expect(activeFork([single, first, deeper])).toBe(deeper);
    expect(activeFork([single])).toBeNull();
  });
});
