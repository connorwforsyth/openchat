import { describe, expect, it } from "vitest";

import {
  capMemory,
  memoryInstructions,
  withMemoryInstructions,
} from "./prompt";

const ONLY_MEMORY = /^## Memory/;
const AFTER_BASE = /^Be terse\.\n\n## Memory/;

describe("capMemory", () => {
  it("keeps a file that fits as is", () => {
    expect(capMemory("  - Prefers pnpm\n", 100)).toEqual({
      omitted: 0,
      text: "- Prefers pnpm",
    });
  });

  it("cuts an oversized file at a line boundary", () => {
    const content = ["- one entry", "- two entry", "- three entry"].join("\n");
    const capped = capMemory(content, 30);
    expect(capped.text).toBe("- one entry\n- two entry");
    expect(capped.omitted).toBe(content.length - capped.text.length);
  });

  it("cuts mid-line when the only line break would waste most of the budget", () => {
    const capped = capMemory(`a\n${"b".repeat(100)}`, 20);
    expect(capped.text).toBe(`a\n${"b".repeat(18)}`);
    expect(capped.omitted).toBe(82);
  });
});

describe("memoryInstructions", () => {
  it("shows the file and tells the model how to update it", () => {
    const text = memoryInstructions({
      content: "- Prefers pnpm",
      maxChars: 100,
      mode: "auto",
    });
    expect(text).toContain("<memory>\n- Prefers pnpm\n</memory>");
    expect(text).toContain("`update_memory`");
    expect(text).toContain("I'll remember that you prefer pnpm");
    expect(text).not.toContain("reviews memory changes");
  });

  it("marks an empty file, a cut file and propose mode", () => {
    expect(
      memoryInstructions({ content: "", maxChars: 100, mode: "auto" })
    ).toContain("<memory>\n(empty)\n</memory>");
    const cut = memoryInstructions({
      content: "x".repeat(50),
      maxChars: 10,
      mode: "propose",
    });
    expect(cut).toContain("40 more characters aren't shown");
    expect(cut).toContain("reviews memory changes");
  });
});

describe("withMemoryInstructions", () => {
  it("appends the section to existing instructions", () => {
    const memory = { content: "", maxChars: 100, mode: "auto" } as const;
    expect(withMemoryInstructions(undefined, memory)).toMatch(ONLY_MEMORY);
    expect(withMemoryInstructions("Be terse.", memory)).toMatch(AFTER_BASE);
  });
});
