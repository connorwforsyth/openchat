import { reviewerDefinition } from "@workspace/contract/fixtures";
import { describe, expect, it } from "vitest";

import { exportFileName, importDocumentFrom } from "./transfer";

describe("importDocumentFrom", () => {
  it("reads our own export", () => {
    const text = JSON.stringify({
      definition: reviewerDefinition,
      description: "",
      exportedAt: "2026-09-27T00:00:00.000Z",
      format: "native",
      formatVersion: 1,
      icon: null,
      name: "Reviewer",
    });
    const read = importDocumentFrom(text);
    expect(read.ok && read.value.format).toBe("native");
  });

  it("offers anything agent-shaped to the LibreChat importer", () => {
    const read = importDocumentFrom(
      JSON.stringify({ instructions: "Hi", model: "gpt-5", name: "Helper" })
    );
    expect(read.ok && read.value.format).toBe("librechat-agent");
  });

  it("refuses what it can't read", () => {
    expect(importDocumentFrom("{not json")).toEqual({
      error: "not_json",
      ok: false,
    });
    expect(importDocumentFrom(JSON.stringify([1, 2]))).toEqual({
      error: "unrecognised",
      ok: false,
    });
    expect(
      importDocumentFrom(JSON.stringify({ format: "other", name: "x" }))
    ).toEqual({ error: "unrecognised", ok: false });
  });
});

describe("exportFileName", () => {
  it("kebab-cases the name", () => {
    expect(exportFileName("Code Reviewer (v2)")).toBe("code-reviewer-v2.json");
    expect(exportFileName("???")).toBe("library-item.json");
  });
});
