import { describe, expect, it } from "vitest";

import { assertNever, capText, clamp, isDefined, keysOf } from "./utils";

describe("utils", () => {
  it("assertNever throws with the unhandled value", () => {
    expect(() => assertNever("surprise" as never, "part")).toThrow(
      'Unhandled part: "surprise"'
    );
  });

  it("isDefined drops null and undefined only", () => {
    expect([0, null, "", undefined, false].filter(isDefined)).toEqual([
      0,
      "",
      false,
    ]);
  });

  it("clamp bounds a number", () => {
    expect(clamp(5, 0, 3)).toBe(3);
    expect(clamp(-1, 0, 3)).toBe(0);
    expect(clamp(2, 0, 3)).toBe(2);
  });

  it("keysOf lists own keys", () => {
    expect(keysOf({ a: 1, b: 2 })).toEqual(["a", "b"]);
  });

  it("capText leaves short text alone", () => {
    expect(capText("hello", 5)).toEqual({ text: "hello", truncated: false });
  });

  it("capText keeps the head and the tail and says how much went", () => {
    const capped = capText(`${"a".repeat(10)}${"b".repeat(10)}`, 8);
    expect(capped).toEqual({
      text: "aaaa\n… 12 characters omitted …\nbbbb",
      truncated: true,
    });
  });

  it("capText with no room keeps only the note", () => {
    expect(capText("abc", 0)).toEqual({
      text: "\n… 3 characters omitted …\n",
      truncated: true,
    });
  });
});
