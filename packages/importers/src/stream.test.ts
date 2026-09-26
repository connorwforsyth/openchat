import { describe, expect, test } from "vitest";

import { detectFormat, parseExport, parseExportStream } from "./parse";
import { splitTopLevel, type TopLevelItem } from "./stream";
import { fixture, fixtureText } from "./testing";

const collect = async <T>(source: AsyncIterable<T>): Promise<T[]> => {
  const out: T[] = [];
  for await (const item of source) {
    out.push(item);
  }
  return out;
};

/** `text` as UTF-8, cut into `size`-byte chunks (so characters split across chunks). */
const chunks = (text: string, size: number): Uint8Array[] => {
  const bytes = new TextEncoder().encode(text);
  const out: Uint8Array[] = [];
  for (let i = 0; i < bytes.length; i += size) {
    out.push(bytes.slice(i, i + size));
  }
  return out;
};

const values = (items: readonly TopLevelItem[]) =>
  items.map((item) => (item.type === "value" ? item.value : item));

describe("splitTopLevel", () => {
  test.each([1, 7, 4096])(
    "yields each element of a root array in %i-byte chunks",
    async (size) => {
      const text = fixtureText("chatgpt-conversations.json");
      const items = await collect(splitTopLevel(chunks(text, size)));
      expect(values(items)).toEqual(JSON.parse(text));
    }
  );

  test("yields a root object whole", async () => {
    const items = await collect(splitTopLevel([' {"a": [1, {"b": "}"}]} \n']));
    expect(items).toEqual([
      {
        index: 0,
        root: "object",
        type: "value",
        value: { a: [1, { b: "}" }] },
      },
    ]);
  });

  test("tracks strings, escapes and primitives", async () => {
    const items = await collect(
      splitTopLevel(['[{"a":"]}\\"{"}, "x,]", 12,true , null,[1,[2]]]'])
    );
    expect(values(items)).toEqual([
      { a: ']}"{' },
      "x,]",
      12,
      true,
      null,
      [1, [2]],
    ]);
  });

  test("skips a value that won't parse and carries on", async () => {
    const items = await collect(splitTopLevel(['[{"a":1}, {b}, {"c":2}]']));
    expect(values(items)).toEqual([
      { a: 1 },
      { index: 1, reason: "invalid_json", type: "skipped" },
      { c: 2 },
    ]);
  });

  test("skips a value over the size limit and carries on", async () => {
    const big = JSON.stringify({ text: "x".repeat(100) });
    const items = await collect(
      splitTopLevel([`[{"a":1},${big},{"c":2}]`], { maxValueChars: 50 })
    );
    expect(values(items)).toEqual([
      { a: 1 },
      { index: 1, reason: "too_large", type: "skipped" },
      { c: 2 },
    ]);
  });

  test("stops at a document that ends mid-value", async () => {
    const items = await collect(splitTopLevel(['[{"a":1}, {"b":']));
    expect(values(items)).toEqual([
      { a: 1 },
      { detail: "ends mid-value", index: 1, type: "fatal" },
    ]);
  });

  test("stops at something that isn't an array or object", async () => {
    expect(await collect(splitTopLevel(["hello"]))).toEqual([
      { detail: "not a JSON array or object", index: 0, type: "fatal" },
    ]);
    expect(await collect(splitTopLevel(["  "]))).toEqual([
      { detail: "empty document", index: 0, type: "fatal" },
    ]);
    expect(await collect(splitTopLevel(["[1] 2"]))).toEqual([
      { index: 0, root: "array", type: "value", value: 1 },
      { detail: "content after the end", index: 1, type: "fatal" },
    ]);
  });
});

describe("parseExportStream", () => {
  test.each([
    "chatgpt-conversations.json",
    "claude-conversations.json",
    "librechat-tree.json",
  ])(
    "parses streamed %s exactly as the in-memory parser does",
    async (name) => {
      const now = () => new Date(0);
      const streamed = await collect(
        parseExportStream(chunks(fixtureText(name), 64), { now })
      );
      expect(streamed).toEqual(parseExport(fixture(name), { now }));
    }
  );

  test("stops after the first value if it isn't a known format", async () => {
    const results = await collect(
      parseExportStream(['[{"version": 4, "history": []}, {"mapping": {}}]'])
    );
    expect(results).toEqual([
      {
        error: { index: 0, reason: "unknown_format", sourceId: null },
        ok: false,
      },
    ]);
  });

  test("reports a truncated export as invalid_json", async () => {
    const results = await collect(parseExportStream(['[{"mapping": {']));
    expect(results).toEqual([
      {
        error: {
          detail: "ends mid-value",
          index: 0,
          reason: "invalid_json",
          sourceId: null,
        },
        ok: false,
      },
    ]);
  });
});

describe("detectFormat", () => {
  test("recognises each export by its shape", () => {
    const [chatgpt] = fixture("chatgpt-conversations.json") as unknown[];
    const [claude] = fixture("claude-conversations.json") as unknown[];
    expect(detectFormat(chatgpt)).toBe("chatgpt");
    expect(detectFormat(claude)).toBe("claude");
    expect(detectFormat(fixture("librechat-flat.json"))).toBe("librechat");
    expect(detectFormat({ history: [] })).toBeNull();
    expect(detectFormat("text")).toBeNull();
  });
});
