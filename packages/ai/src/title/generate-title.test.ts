import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, it } from "vitest";

import { generated } from "../testing/mock-models";
import {
  cleanTitle,
  fallbackTitle,
  generateTitle,
  titleInput,
} from "./generate-title";

const exchange = [
  {
    parts: [
      { text: "How do I index JSONB in Postgres?", type: "text" as const },
    ],
    role: "user" as const,
  },
  {
    parts: [{ text: "Use a GIN index.", type: "text" as const }],
    role: "assistant" as const,
  },
];

describe("cleanTitle", () => {
  it.each([
    ["Indexing JSONB in Postgres", "Indexing JSONB in Postgres"],
    ['"Indexing JSONB in Postgres."', "Indexing JSONB in Postgres"],
    ["Title: **JSONB indexes**\nextra line", "JSONB indexes"],
    ["  spaced   out  ", "spaced out"],
    ["", null],
    ['""', null],
  ])("%j -> %j", (raw, expected) => {
    expect(cleanTitle(raw)).toBe(expected);
  });

  it("caps length", () => {
    expect(cleanTitle("word ".repeat(40))?.length).toBeLessThanOrEqual(80);
  });
});

describe("generateTitle", () => {
  it("titles the first exchange from its text only", async () => {
    const model = new MockLanguageModelV4({
      doGenerate: generated([
        { text: '"JSONB indexes in Postgres."', type: "text" },
      ]),
    });
    expect(await generateTitle(exchange, model)).toEqual({
      ok: true,
      value: "JSONB indexes in Postgres",
    });
    expect(JSON.stringify(model.doGenerateCalls[0]?.prompt)).toContain(
      "GIN index"
    );
  });

  it("fails without text or when the model says nothing", async () => {
    const model = new MockLanguageModelV4({
      doGenerate: generated([{ text: " ", type: "text" }]),
    });
    expect(await generateTitle(exchange, model)).toMatchObject({
      error: { code: "provider_error" },
    });
    expect(
      titleInput([{ parts: [{ type: "step-start" }], role: "assistant" }])
    ).toBe("");
    expect(await generateTitle([], model)).toMatchObject({ ok: false });
  });
});

describe("fallbackTitle", () => {
  const user = (text: string) => ({
    parts: [{ text, type: "text" as const }],
    role: "user" as const,
  });

  it("uses the first sentence of the first user message", () => {
    expect(fallbackTitle(exchange)).toBe("How do I index JSONB in Postgres");
  });

  it("cuts a long sentence to a few words", () => {
    expect(
      fallbackTitle([
        user("please help me write a cover letter for a job at a bakery"),
      ])
    ).toBe("please help me write a cover letter for…");
  });

  it("keeps dotted words whole", () => {
    expect(
      fallbackTitle([user("What's new in Next.js 16? Asking for v1.2")])
    ).toBe("What's new in Next.js 16");
    expect(fallbackTitle([user("東京の天気。明日は？")])).toBe("東京の天気");
  });

  it("is null without user text", () => {
    expect(fallbackTitle([user("   ")])).toBeNull();
    expect(fallbackTitle([])).toBeNull();
  });
});
