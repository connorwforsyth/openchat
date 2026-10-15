import { describe, expect, it } from "vitest";

import { allot, capToolResult, MAX_TOOL_RESULT_CHARS } from "./result-cap";

const CUT_ROWS =
  /^\{"rows":\[\{"id":0\}.*characters omitted.*\{"id":199\}\]\}$/s;
const CUT_JSON = /^\{"toolResult":"v+\n… \d+ characters omitted …\nv+"\}$/;

const text = (value: string) => ({ text: value, type: "text" });
const sizeOf = (result: unknown) => JSON.stringify(result).length;

describe("allot", () => {
  it("gives everyone all they ask for when it fits", () => {
    expect(allot([3, 4], 10)).toEqual([3, 4]);
  });

  it("lets small items keep theirs and splits the rest among the big", () => {
    expect(allot([100, 2, 100], 42)).toEqual([20, 2, 20]);
  });

  it("gives nothing when there's no room", () => {
    expect(allot([5, 5], 0)).toEqual([0, 0]);
  });
});

describe("capToolResult", () => {
  it("hands back a small result as it came", () => {
    const result = { content: [text("hello")], structuredContent: { a: 1 } };
    expect(capToolResult(result)).toBe(result);
  });

  it("keeps a long text's head and tail and says how much went", () => {
    const long = `${"a".repeat(600)}${"z".repeat(600)}`;
    const capped = capToolResult({ content: [text(long)] }, 100) as {
      content: { text: string }[];
    };
    expect(capped.content[0]?.text).toBe(
      `${"a".repeat(50)}\n… 1100 characters omitted …\n${"z".repeat(50)}`
    );
  });

  it("bounds a megabyte result near the default cap", () => {
    const capped = capToolResult({ content: [text("x".repeat(1_000_000))] });
    expect(sizeOf(capped)).toBeLessThan(MAX_TOOL_RESULT_CHARS + 100);
  });

  it("shares the budget so a short part survives next to a long one", () => {
    const capped = capToolResult(
      { content: [text("Summary: 3 rows."), text("y".repeat(10_000))] },
      1000
    ) as { content: { text: string }[] };
    expect(capped.content[0]?.text).toBe("Summary: 3 rows.");
    expect(capped.content[1]?.text).toContain("characters omitted");
    expect(capped.content[1]?.text.length).toBeLessThan(1100);
  });

  it("passes images and unknown fields through", () => {
    const image = {
      data: "i".repeat(5000),
      mimeType: "image/png",
      type: "image",
    };
    const capped = capToolResult(
      {
        _meta: { trace: "t" },
        content: [image, text("w".repeat(5000))],
        isError: true,
      },
      100
    ) as { _meta: unknown; content: unknown[]; isError: boolean };
    expect(capped.content[0]).toBe(image);
    expect(capped._meta).toEqual({ trace: "t" });
    expect(capped.isError).toBe(true);
  });

  it("cuts a text resource's text and keeps its uri", () => {
    const capped = capToolResult(
      {
        content: [
          {
            resource: {
              mimeType: "text/plain",
              text: "r".repeat(500),
              uri: "file:///log",
            },
            type: "resource",
          },
        ],
      },
      50
    ) as { content: { resource: { text: string; uri: string } }[] };
    expect(capped.content[0]?.resource.uri).toBe("file:///log");
    expect(capped.content[0]?.resource.text).toContain(
      "450 characters omitted"
    );
  });

  it("keeps structured content that fits its share", () => {
    const capped = capToolResult(
      { content: [text("t".repeat(500))], structuredContent: { ok: true } },
      100
    ) as { structuredContent: unknown };
    expect(capped.structuredContent).toEqual({ ok: true });
  });

  it("turns structured content too big for its share into a cut text", () => {
    const rows = Array.from({ length: 200 }, (_, id) => ({ id }));
    const capped = capToolResult(
      { content: [text("200 rows")], structuredContent: { rows } },
      200
    ) as { content: { text: string }[]; structuredContent?: unknown };
    expect(capped.structuredContent).toBeUndefined();
    expect(capped.content[0]?.text).toBe("200 rows");
    expect(capped.content[1]?.text).toMatch(CUT_ROWS);
  });

  it("cuts a result without content as JSON text", () => {
    const capped = capToolResult({ toolResult: "v".repeat(1000) }, 100) as {
      content: { text: string; type: string }[];
    };
    expect(capped.content).toHaveLength(1);
    expect(capped.content[0]?.text).toMatch(CUT_JSON);
  });
});
