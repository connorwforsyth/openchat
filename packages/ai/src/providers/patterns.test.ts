import { describe, expect, it } from "vitest";

import { globMatcher, patternFilter } from "./patterns";

describe("globMatcher", () => {
  it("lets * cross slashes and ? match one character", () => {
    const matches = globMatcher(["anthropic/*", "openai/gpt-5?"]);
    expect(matches("anthropic/claude-haiku-4.5")).toBe(true);
    expect(matches("anthropic/nested/id")).toBe(true);
    expect(matches("openai/gpt-5o")).toBe(true);
    expect(matches("openai/gpt-5")).toBe(false);
    expect(matches("openai/gpt-5-mini")).toBe(false);
    expect(matches("google/gemini-2.5-pro")).toBe(false);
  });

  it("treats every other character literally", () => {
    const matches = globMatcher(["gpt-4.1", "a+b", "(x)|y"]);
    expect(matches("gpt-4.1")).toBe(true);
    expect(matches("gpt-4x1")).toBe(false);
    expect(matches("a+b")).toBe(true);
    expect(matches("aab")).toBe(false);
    expect(matches("(x)|y")).toBe(true);
    expect(matches("y")).toBe(false);
  });

  it("matches the whole id, not a substring", () => {
    const matches = globMatcher(["gpt-5*"]);
    expect(matches("openai/gpt-5")).toBe(false);
    expect(matches("gpt-5-mini")).toBe(true);
  });

  it("matches nothing with no globs", () => {
    expect(globMatcher([])("anything")).toBe(false);
  });
});

describe("patternFilter", () => {
  it("allows everything with neither include nor exclude", () => {
    expect(patternFilter({ exclude: [], include: [] })("any/model")).toBe(true);
  });

  it("allows only what include matches, minus what exclude matches", () => {
    const allowed = patternFilter({
      exclude: ["*-preview", "openai/gpt-5-pro*"],
      include: ["anthropic/*", "openai/gpt-5*"],
    });
    expect(allowed("anthropic/claude-sonnet-4.5")).toBe(true);
    expect(allowed("openai/gpt-5-mini")).toBe(true);
    expect(allowed("openai/gpt-5-pro")).toBe(false);
    expect(allowed("anthropic/claude-next-preview")).toBe(false);
    expect(allowed("xai/grok-4")).toBe(false);
  });

  it("applies exclude alone to everything else", () => {
    const allowed = patternFilter({ exclude: ["*embed*"], include: [] });
    expect(allowed("nomic-embed-text")).toBe(false);
    expect(allowed("llama3.2")).toBe(true);
  });
});
