import { describe, expect, it } from "vitest";

import { stampLocation } from "./slide-inspect";

describe("stampLocation", () => {
  it("reads a slide's stamp, with its column", () => {
    expect(stampLocation("slides/intro.tsx:5:4", "slides/intro.tsx")).toEqual({
      column: 4,
      line: 5,
    });
  });

  it("ignores another slide's stamp, and one without a column", () => {
    expect(
      stampLocation("slides/close.tsx:5:4", "slides/intro.tsx")
    ).toBeNull();
    expect(stampLocation("slides/intro.tsx:5", "slides/intro.tsx")).toBeNull();
  });
});
