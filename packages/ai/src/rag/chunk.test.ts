import { describe, expect, it } from "vitest";

import {
  chunkDocument,
  chunkOptionsSchema,
  documentChunkSchema,
  estimateTokens,
} from "./chunk";

const WHITESPACE = /\s+/;

const sentence = (n: number) =>
  `Sentence ${n} talks about orchards and the fruit that grows in them.`;
const paragraph = (from: number, count: number) =>
  Array.from({ length: count }, (_, i) => sentence(from + i)).join(" ");

describe("estimateTokens", () => {
  it("counts about four characters a token, and CJK a character each", () => {
    expect(estimateTokens("")).toBe(0);
    expect(estimateTokens("abcd".repeat(10))).toBe(10);
    expect(estimateTokens("日本語のテキスト")).toBe(8);
  });
});

describe("chunkDocument", () => {
  it("keeps a short document whole", () => {
    expect(chunkDocument("Just one line.")).toEqual([
      { headings: [], page: null, text: "Just one line.", tokenCount: 4 },
    ]);
    expect(chunkDocument("  \n\n ")).toEqual([]);
  });

  it("starts a chunk at each heading and prefixes the heading path", () => {
    const chunks = chunkDocument(
      [
        "# Guide",
        "Intro paragraph.",
        "## Install",
        "Run the installer.",
        "### Linux",
        "Use the package manager.",
        "## Usage",
        "Open the app.",
      ].join("\n\n")
    );
    expect(chunks.map((chunk) => [chunk.headings, chunk.text])).toEqual([
      [["Guide"], "Guide\n\nIntro paragraph."],
      [["Guide", "Install"], "Guide › Install\n\nRun the installer."],
      [
        ["Guide", "Install", "Linux"],
        "Guide › Install › Linux\n\nUse the package manager.",
      ],
      [["Guide", "Usage"], "Guide › Usage\n\nOpen the app."],
    ]);
  });

  it("doesn't emit empty chunks for headings with nothing under them", () => {
    const chunks = chunkDocument("# A\n\n## B\n\nBody text.");
    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.headings).toEqual(["A", "B"]);
  });

  it("packs paragraphs up to the budget and overlaps consecutive chunks", () => {
    const text = [paragraph(1, 6), paragraph(7, 6), paragraph(13, 6)].join(
      "\n\n"
    );
    const chunks = chunkDocument(text, { maxTokens: 120, overlapTokens: 20 });
    expect(chunks.length).toBeGreaterThan(2);
    for (const chunk of chunks) {
      expect(documentChunkSchema.parse(chunk)).toEqual(chunk);
      expect(chunk.tokenCount).toBeLessThanOrEqual(120);
    }
    // Every sentence survives somewhere.
    const all = chunks.map((chunk) => chunk.text).join(" ");
    for (let n = 1; n <= 18; n += 1) {
      expect(all).toContain(sentence(n));
    }
    // Each later chunk opens with the end of the one before.
    for (let index = 1; index < chunks.length; index += 1) {
      const previous = chunks[index - 1]?.text ?? "";
      const opening = chunks[index]?.text
        .split(WHITESPACE)
        .slice(0, 3)
        .join(" ");
      expect(previous).toContain(opening);
    }
  });

  it("doesn't overlap across a heading", () => {
    const chunks = chunkDocument(
      `# One\n\n${paragraph(1, 3)}\n\n# Two\n\n${paragraph(4, 1)}`,
      { maxTokens: 400, overlapTokens: 40 }
    );
    expect(chunks.map((chunk) => chunk.headings)).toEqual([["One"], ["Two"]]);
    expect(chunks[1]?.text).toBe(`Two\n\n${sentence(4)}`);
  });

  it("splits an oversized paragraph at sentences, then words, then characters", () => {
    const long = paragraph(1, 40);
    const chunks = chunkDocument(long, { maxTokens: 64, overlapTokens: 0 });
    expect(chunks.length).toBeGreaterThan(5);
    expect(chunks.every((chunk) => chunk.tokenCount <= 64)).toBe(true);
    expect(chunks[0]?.text.startsWith(sentence(1))).toBe(true);

    const blob = "x".repeat(2000);
    const pieces = chunkDocument(blob, { maxTokens: 64, overlapTokens: 0 });
    expect(pieces.map((chunk) => chunk.text).join("")).toBe(blob);
    expect(pieces.every((chunk) => chunk.tokenCount <= 64)).toBe(true);
  });

  it("keeps code fences whole and never reads `#` inside them as headings", () => {
    const text = "# Script\n\n```sh\n# not a heading\necho hi\n```\n\nAfter.";
    const chunks = chunkDocument(text);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.headings).toEqual(["Script"]);
    expect(chunks[0]?.text).toContain("# not a heading\necho hi");
  });

  it("records pages and never spans two", () => {
    const chunks = chunkDocument([
      { page: 1, text: "# Report\n\nFirst page." },
      { page: 2, text: "Second page." },
    ]);
    expect(chunks.map((chunk) => [chunk.page, chunk.text])).toEqual([
      [1, "Report\n\nFirst page."],
      [2, "Report\n\nSecond page."],
    ]);
  });

  it("rejects an overlap too large for the budget", () => {
    expect(
      chunkOptionsSchema.safeParse({ maxTokens: 100, overlapTokens: 60 })
        .success
    ).toBe(false);
  });
});
