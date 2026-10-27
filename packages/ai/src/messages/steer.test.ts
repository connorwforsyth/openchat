import type { MessagePart } from "@workspace/contract/schemas/message-parts";
import { newId } from "@workspace/shared/ids";
import { describe, expect, it } from "vitest";

import { STEER_DATA, type SteerData, splitAtSteers } from "./steer";

const text = (value: string): MessagePart => ({ text: value, type: "text" });

const marker = (previousAnswerId: string): SteerData => ({
  answerId: newId("message"),
  messages: [
    {
      authorId: newId("user"),
      createdAt: "2026-10-27T10:00:00.000Z",
      id: newId("message"),
      parts: [text("Steer.")],
    },
  ],
  previousAnswerId: previousAnswerId as SteerData["previousAnswerId"],
});

const markerPart = (data: SteerData): MessagePart => ({
  data,
  id: data.answerId,
  name: STEER_DATA,
  type: "data",
});

describe("splitAtSteers", () => {
  it("cuts an answer at each marker into the answers the markers name", () => {
    const first = newId("message");
    const one = marker(first);
    const two = marker(one.answerId);
    const segments = splitAtSteers(first, [
      text("a"),
      markerPart(one),
      text("b"),
      markerPart(two),
      text("c"),
    ]);
    expect(segments).toEqual([
      { answerId: first, parts: [text("a")] },
      { answerId: one.answerId, parts: [text("b")], steer: one },
      { answerId: two.answerId, parts: [text("c")], steer: two },
    ]);
  });

  it("keeps an answer without markers whole", () => {
    const first = newId("message");
    expect(splitAtSteers(first, [text("a")])).toEqual([
      { answerId: first, parts: [text("a")] },
    ]);
  });

  it("ignores a data part that only looks like a marker", () => {
    const first = newId("message");
    const odd: MessagePart = {
      data: { nope: true },
      name: STEER_DATA,
      type: "data",
    };
    expect(splitAtSteers(first, [odd])).toEqual([
      { answerId: first, parts: [odd] },
    ]);
  });
});
