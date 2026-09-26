import { describe, expect, it } from "vitest";

import {
  negotiateLocale,
  parseAcceptLanguage,
  resolveLocale,
} from "./negotiate";

describe("parseAcceptLanguage", () => {
  it("orders ranges by quality, keeping header order for ties", () => {
    expect(parseAcceptLanguage("fr;q=0.5, en-GB, de;q=0.9, en")).toEqual([
      { quality: 1, tag: "en-gb" },
      { quality: 1, tag: "en" },
      { quality: 0.9, tag: "de" },
      { quality: 0.5, tag: "fr" },
    ]);
  });

  it("skips malformed and zero-quality parts", () => {
    expect(parseAcceptLanguage(",;q=1, fr;q=abc, de;q=0, it;q=2, es")).toEqual([
      { quality: 1, tag: "es" },
    ]);
  });

  it("returns nothing for a missing header", () => {
    expect(parseAcceptLanguage(undefined)).toEqual([]);
    expect(parseAcceptLanguage(null)).toEqual([]);
    expect(parseAcceptLanguage("")).toEqual([]);
  });
});

describe("negotiateLocale", () => {
  const available = ["en", "fr", "pt-BR"] as const;

  it("picks the best exact match", () => {
    expect(negotiateLocale("de, fr;q=0.8, en;q=0.5", available, "en")).toBe(
      "fr"
    );
  });

  it("matches case-insensitively and returns the canonical tag", () => {
    expect(negotiateLocale("PT-br", available, "en")).toBe("pt-BR");
  });

  it("falls back from a region to its base language and back", () => {
    expect(negotiateLocale("fr-CA", available, "en")).toBe("fr");
    expect(negotiateLocale("pt", available, "en")).toBe("pt-BR");
  });

  it("uses the fallback for no match, a wildcard or no header", () => {
    expect(negotiateLocale("ja, ko", available, "en")).toBe("en");
    expect(negotiateLocale("*", available, "fr")).toBe("fr");
    expect(negotiateLocale(undefined, available, "en")).toBe("en");
  });
});

describe("resolveLocale", () => {
  it("prefers a supported saved user locale", () => {
    expect(resolveLocale({ acceptLanguage: "fr", userLocale: "en" })).toBe(
      "en"
    );
  });

  it("ignores an unsupported saved locale and negotiates instead", () => {
    expect(resolveLocale({ acceptLanguage: "en-AU", userLocale: "xx" })).toBe(
      "en"
    );
  });

  it("defaults to the source locale with nothing to go on", () => {
    expect(resolveLocale({})).toBe("en");
  });
});
