import type { MessagePart } from "@workspace/contract/schemas/message-parts";
import { describe, expect, test } from "vitest";

import type { ImportedMessage } from "./schema";
import {
  buildTree,
  checkTree,
  type DraftMessage,
  mergeAssistantChains,
  orderParentsFirst,
} from "./tree";

const text = (value: string): MessagePart[] => [{ text: value, type: "text" }];

const draft = (
  sourceId: string,
  parentSourceId: string | null,
  createdAtMs: number | null,
  role: "user" | "assistant" = "user"
): DraftMessage => ({
  body: {
    createdAtMs,
    model: null,
    parts: text(sourceId),
    role,
    status: "complete",
  },
  parentSourceId,
  sourceId,
});

const hidden = (
  sourceId: string,
  parentSourceId: string | null
): DraftMessage => ({
  body: null,
  parentSourceId,
  sourceId,
});

const shape = (messages: readonly ImportedMessage[]) =>
  messages.map((m) => [m.sourceId, m.parentSourceId, Date.parse(m.createdAt)]);

describe("buildTree", () => {
  test("attaches children of passed-over nodes to the nearest kept ancestor", () => {
    const tree = buildTree(
      [
        hidden("root", null),
        hidden("system", "root"),
        draft("a", "system", 10),
        hidden("recap", "a"),
        hidden("recap2", "recap"),
        draft("b", "recap2", 20),
      ],
      0
    );
    expect(shape(tree.messages)).toEqual([
      ["a", null, 10],
      ["b", "a", 20],
    ]);
    expect(tree.resolve("recap2")).toBe("a");
    expect(tree.resolve("system")).toBeNull();
    expect(tree.resolve("missing")).toBeNull();
    expect(tree.resolve(null)).toBeNull();
  });

  test("cuts parent cycles and orders children after parents", () => {
    const tree = buildTree(
      [draft("a", "c", 30), draft("b", "a", 5), draft("c", "b", 1)],
      0
    );
    const result = shape(tree.messages);
    // One link of the cycle is cut, making its node a root; the rest follow it in time.
    expect(result.filter(([, parent]) => parent === null)).toHaveLength(1);
    expect(checkTree(tree.messages).ok).toBe(true);
  });

  test("dates undated messages from their parent, or the fallback for a root", () => {
    const tree = buildTree(
      [draft("a", null, null), draft("b", "a", null), draft("c", "b", 5)],
      100
    );
    expect(shape(tree.messages)).toEqual([
      ["a", null, 100],
      ["b", "a", 101],
      ["c", "b", 102],
    ]);
  });

  test("keeps the first of two nodes with the same id", () => {
    const tree = buildTree([draft("a", null, 1), draft("a", null, 2)], 0);
    expect(shape(tree.messages)).toEqual([["a", null, 1]]);
  });
});

describe("mergeAssistantChains", () => {
  test("folds an only child into its assistant parent, not at a branch point", () => {
    const { messages } = buildTree(
      [
        draft("u", null, 1),
        draft("call", "u", 2, "assistant"),
        draft("result", "call", 3, "assistant"),
        draft("answer", "result", 4, "assistant"),
        draft("next", "answer", 5),
        draft("fork", "u", 6, "assistant"),
        draft("fork-a", "fork", 7, "assistant"),
        draft("fork-b", "fork", 8, "assistant"),
      ],
      0
    );
    const merged = mergeAssistantChains(messages);
    expect(
      merged.messages.map((m) => [m.sourceId, m.parentSourceId, m.parts.length])
    ).toEqual([
      ["u", null, 1],
      ["call", "u", 3],
      ["next", "call", 1],
      ["fork", "u", 1],
      ["fork-a", "fork", 1],
      ["fork-b", "fork", 1],
    ]);
    expect(merged.resolve("answer")).toBe("call");
    expect(merged.resolve("fork-b")).toBe("fork-b");
  });
});

describe("checkTree", () => {
  const at = (sourceId: string, parentSourceId: string | null, ms: number) => ({
    createdAt: new Date(ms).toISOString(),
    parentSourceId,
    sourceId,
  });

  test("accepts parents first, children no older", () => {
    expect(checkTree([at("a", null, 1), at("b", "a", 1)]).ok).toBe(true);
  });

  test("rejects duplicates, missing or late parents and time travel", () => {
    expect(checkTree([at("a", null, 1), at("a", null, 2)])).toMatchObject({
      error: "duplicate id a",
    });
    expect(checkTree([at("b", "a", 1), at("a", null, 0)])).toMatchObject({
      error: "parent of b missing or listed after it",
    });
    expect(checkTree([at("a", null, 5), at("b", "a", 1)])).toMatchObject({
      error: "b is older than its parent",
    });
  });
});

describe("orderParentsFirst", () => {
  test("lists parents before children, siblings in input order", () => {
    const ordered = orderParentsFirst([
      { id: "c", parentId: "b" },
      { id: "b2", parentId: "a" },
      { id: "b", parentId: "a" },
      { id: "a", parentId: null },
      { id: "orphan", parentId: "gone" },
    ]);
    expect(ordered.map((node) => node.id)).toEqual([
      "a",
      "b2",
      "b",
      "c",
      "orphan",
    ]);
  });
});
