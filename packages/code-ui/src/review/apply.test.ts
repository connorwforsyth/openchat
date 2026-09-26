import { describe, expect, it } from "vitest";

import { applyReview, splitLines } from "./apply";
import { originalSource, twoHunkEdit } from "./fixtures";

const accept = (hunkId: string) => ({ decision: "accept" as const, hunkId });
const reject = (hunkId: string) => ({ decision: "reject" as const, hunkId });

describe("splitLines", () => {
  it("keeps line endings so joining is lossless", () => {
    const text = "a\r\nb\nc";
    expect(splitLines(text)).toEqual(["a\r\n", "b\n", "c"]);
    expect(splitLines(text).join("")).toBe(text);
    expect(splitLines("")).toEqual([]);
  });
});

describe("applyReview", () => {
  it("applies every accepted hunk", () => {
    const result = applyReview(originalSource, twoHunkEdit, [
      accept("h1"),
      accept("h2"),
    ]);
    expect(result).toEqual({
      ok: true,
      value: originalSource
        .replace(
          "  return sum;",
          "  const tax = sum * 0.2;\n  return sum + tax;"
        )
        .replace("`$${value}`", () => "`$${value.toFixed(2)}`"),
    });
  });

  it("leaves a rejected hunk unapplied", () => {
    const result = applyReview(originalSource, twoHunkEdit, [
      accept("h1"),
      reject("h2"),
    ]);
    expect(result).toEqual({
      ok: true,
      value: originalSource.replace(
        "  return sum;",
        "  const tax = sum * 0.2;\n  return sum + tax;"
      ),
    });
  });

  it("applies only the later hunk when the first is rejected", () => {
    const result = applyReview(originalSource, twoHunkEdit, [
      reject("h1"),
      accept("h2"),
    ]);
    expect(result).toEqual({
      ok: true,
      value: originalSource.replace(
        "`$${value}`",
        () => "`$${value.toFixed(2)}`"
      ),
    });
  });

  it("returns the original when nothing is accepted", () => {
    expect(applyReview(originalSource, twoHunkEdit, [])).toEqual({
      ok: true,
      value: originalSource,
    });
  });

  it("fails on a stale proposal instead of splicing blindly", () => {
    const stale = originalSource.replace("const sum", "let sum");
    const result = applyReview(stale, twoHunkEdit, [accept("h1")]);
    expect(result).toEqual({
      error: {
        actual: "  let sum = total(items);",
        expected: "  const sum = total(items);",
        hunkIndex: 0,
        kind: "context-mismatch",
        lineNumber: 4,
      },
      ok: false,
    });
  });

  it("keeps CRLF line endings", () => {
    const crlf = originalSource.replaceAll("\n", "\r\n");
    const result = applyReview(crlf, twoHunkEdit, [accept("h1"), reject("h2")]);
    expect(result.ok && result.value).toBe(
      crlf.replace(
        "  return sum;",
        "  const tax = sum * 0.2;\r\n  return sum + tax;"
      )
    );
  });

  it("inserts into an empty file", () => {
    const result = applyReview(
      "",
      {
        hunks: [
          { hunkId: "new", newLines: 2, newStart: 1, oldLines: 0, oldStart: 0 },
        ],
        patch: "@@ -0,0 +1,2 @@\n+a\n+b\n",
        path: "new.txt",
      },
      [accept("new")]
    );
    expect(result).toEqual({ ok: true, value: "a\nb\n" });
  });

  it("honours a missing final newline", () => {
    const result = applyReview(
      "a\nb",
      {
        hunks: [
          { hunkId: "eof", newLines: 2, newStart: 1, oldLines: 2, oldStart: 1 },
        ],
        patch:
          "@@ -1,2 +1,2 @@\n a\n-b\n\\ No newline at end of file\n+c\n\\ No newline at end of file\n",
        path: "x.txt",
      },
      [accept("eof")]
    );
    expect(result).toEqual({ ok: true, value: "a\nc" });
  });

  it("reports a patch whose hunks don't match the proposal", () => {
    const result = applyReview(
      originalSource,
      {
        ...twoHunkEdit,
        hunks: [
          { hunkId: "h1", newLines: 5, newStart: 3, oldLines: 9, oldStart: 3 },
        ],
      },
      [accept("h1")]
    );
    expect(result).toEqual({
      error: { kind: "hunk-mismatch", missing: ["h1"] },
      ok: false,
    });
  });
});
