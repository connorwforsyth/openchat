import { describe, expect, it } from "vitest";

import { coalesceDeltas } from "./coalesce-deltas";

const text = (id: string, delta: string) =>
  ({ delta, id, type: "text-delta" }) as const;
const reasoning = (id: string, delta: string) =>
  ({ delta, id, type: "reasoning-delta" }) as const;

describe("coalesceDeltas", () => {
  it("merges a run of text deltas for one part, counting what it holds", () => {
    expect(
      coalesceDeltas([
        { id: "t1", type: "text-start" },
        text("t1", "Hel"),
        text("t1", "lo, "),
        text("t1", "world"),
        { id: "t1", type: "text-end" },
      ])
    ).toEqual([
      { count: 1, payload: { id: "t1", type: "text-start" } },
      { count: 3, payload: text("t1", "Hello, world") },
      { count: 1, payload: { id: "t1", type: "text-end" } },
    ]);
  });

  it("merges reasoning deltas the same way, but never with text", () => {
    expect(
      coalesceDeltas([
        reasoning("r1", "Think"),
        reasoning("r1", "ing"),
        text("r1", "Said"),
        text("r1", " so"),
      ])
    ).toEqual([
      { count: 2, payload: reasoning("r1", "Thinking") },
      { count: 2, payload: text("r1", "Said so") },
    ]);
  });

  it("keeps interleaved parts apart and in order", () => {
    expect(
      coalesceDeltas([
        text("a", "1"),
        text("b", "2"),
        text("a", "3"),
        text("a", "4"),
        text("b", "5"),
      ])
    ).toEqual([
      { count: 1, payload: text("a", "1") },
      { count: 1, payload: text("b", "2") },
      { count: 2, payload: text("a", "34") },
      { count: 1, payload: text("b", "5") },
    ]);
  });

  it("doesn't merge across a chunk of another type", () => {
    const tool = {
      input: { q: "x" },
      toolCallId: "c1",
      toolName: "search",
      type: "tool-input-available",
    };
    expect(
      coalesceDeltas([text("a", "1"), tool, text("a", "2"), text("a", "3")])
    ).toEqual([
      { count: 1, payload: text("a", "1") },
      { count: 1, payload: tool },
      { count: 2, payload: text("a", "23") },
    ]);
  });

  it("merges only when the other fields match, so no metadata is lost", () => {
    const meta = (signature: string) => ({
      providerMetadata: { anthropic: { signature } },
    });
    expect(
      coalesceDeltas([
        { ...reasoning("r", "a"), ...meta("x") },
        { ...reasoning("r", "b"), ...meta("x") },
        { ...reasoning("r", "c"), ...meta("y") },
        reasoning("r", "d"),
      ])
    ).toEqual([
      { count: 2, payload: { ...reasoning("r", "ab"), ...meta("x") } },
      { count: 1, payload: { ...reasoning("r", "c"), ...meta("y") } },
      { count: 1, payload: reasoning("r", "d") },
    ]);
  });

  it("passes through what isn't a well-formed delta", () => {
    const odd = [
      { delta: 1, id: "a", type: "text-delta" },
      { delta: 2, id: "a", type: "text-delta" },
      "text-delta",
      null,
    ];
    expect(coalesceDeltas(odd)).toEqual(
      odd.map((payload) => ({ count: 1, payload }))
    );
  });

  it("leaves its input alone", () => {
    const input = [text("a", "1"), text("a", "2")];
    const copy = structuredClone(input);
    coalesceDeltas(input);
    expect(input).toEqual(copy);
    expect(coalesceDeltas([])).toEqual([]);
  });
});
