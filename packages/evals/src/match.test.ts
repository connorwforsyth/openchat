import { describe, expect, it } from "vitest";

import { deepEqual, matches, show } from "./match";

const NPM = /^npm /;
const B = /b/;
const FOUR = /4/;
const HTML = /\.html$/;

describe("matches", () => {
  it("matches only the keys the matcher names", () => {
    expect(matches({ content: "x", path: "a.txt" }, { path: "a.txt" })).toBe(
      true
    );
    expect(matches({ path: "b.txt" }, { path: "a.txt" })).toBe(false);
    expect(matches("a.txt", { path: "a.txt" })).toBe(false);
  });

  it("takes regular expressions, predicates and nested shapes", () => {
    const args = { command: "npm test", env: { CI: "1" }, tags: ["a", "b"] };
    expect(matches(args, { command: NPM })).toBe(true);
    expect(matches(args, { env: { CI: "1" }, tags: ["a", B] })).toBe(true);
    expect(matches(args, { tags: ["a"] })).toBe(false);
    expect(
      matches(args, (value) => typeof value === "object" && value !== null)
    ).toBe(true);
    expect(matches(42, FOUR)).toBe(false);
  });
});

describe("deepEqual", () => {
  it("compares JSON structurally", () => {
    expect(deepEqual({ a: [1, { b: null }] }, { a: [1, { b: null }] })).toBe(
      true
    );
    expect(deepEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false);
    expect(deepEqual([1, 2], [2, 1])).toBe(false);
    expect(deepEqual([], {})).toBe(false);
  });
});

describe("show", () => {
  it("cuts long values and keeps matchers readable", () => {
    expect(show({ path: HTML })).toBe('{"path":"/\\\\.html$/"}');
    expect(show("x".repeat(1000))).toContain("… (1002 characters)");
  });
});
