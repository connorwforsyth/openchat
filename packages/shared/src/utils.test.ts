import { describe, expect, it } from "vitest";

import { assertNever, clamp, isDefined, keysOf } from "./utils";

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
});
