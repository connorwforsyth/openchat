import type { ConversationId } from "@workspace/contract/schemas/common";
import { describe, expect, it } from "vitest";

import { emptySelection, selectionReducer } from "./selection";

const order = ["a", "b", "c", "d"] as ConversationId[];
const [a, b, c, d] = order as [
  ConversationId,
  ConversationId,
  ConversationId,
  ConversationId,
];

describe("selectionReducer", () => {
  it("toggles rows on and off", () => {
    const one = selectionReducer(emptySelection, { id: b, type: "toggle" });
    expect([...one.ids]).toEqual([b]);
    expect([...selectionReducer(one, { id: b, type: "toggle" }).ids]).toEqual(
      []
    );
  });

  it("selects a range from the anchor, either direction", () => {
    const anchored = selectionReducer(emptySelection, {
      id: c,
      type: "toggle",
    });
    expect(
      [
        ...selectionReducer(anchored, { id: a, order, type: "range" }).ids,
      ].sort()
    ).toEqual([a, b, c]);
    expect(
      [
        ...selectionReducer(anchored, { id: d, order, type: "range" }).ids,
      ].sort()
    ).toEqual([c, d]);
  });

  it("starts with a toggle when there's no anchor", () => {
    expect([
      ...selectionReducer(emptySelection, { id: d, order, type: "range" }).ids,
    ]).toEqual([d]);
  });

  it("clears, and prunes rows that left the list", () => {
    const two = selectionReducer(
      selectionReducer(emptySelection, { id: a, type: "toggle" }),
      { id: b, type: "toggle" }
    );
    expect([
      ...selectionReducer(two, { keep: new Set([b]), type: "prune" }).ids,
    ]).toEqual([b]);
    expect(selectionReducer(two, { type: "clear" })).toBe(emptySelection);
  });
});
