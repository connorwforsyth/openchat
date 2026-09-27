import { describe, expect, it } from "vitest";

import { slugFrom } from "./org-slug";

describe("slugFrom", () => {
  it("lowercases and dashes what isn't a letter or digit", () => {
    expect(slugFrom("Acme Labs, Inc.")).toBe("acme-labs-inc");
    expect(slugFrom("  Platform -- Eng  ")).toBe("platform-eng");
  });

  it("drops accents", () => {
    expect(slugFrom("Café Réunion")).toBe("cafe-reunion");
  });

  it("stays within 48 characters without a trailing dash", () => {
    const slug = slugFrom(`${"a".repeat(47)} b`);
    expect(slug).toBe("a".repeat(47));
  });

  it("is empty when nothing usable is left", () => {
    expect(slugFrom("日本")).toBe("");
    expect(slugFrom("x")).toBe("");
  });
});
