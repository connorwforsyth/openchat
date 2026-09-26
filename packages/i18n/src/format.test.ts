import { describe, expect, it } from "vitest";

import {
  formatDate,
  formatFileSize,
  formatNumber,
  formatRelativeTime,
} from "./format";

const now = Date.UTC(2026, 8, 26, 12, 0, 0);

describe("formatDate", () => {
  it("formats with the locale's conventions", () => {
    const date = Date.UTC(2026, 0, 31, 12);
    const utc = { dateStyle: "short", timeZone: "UTC" } as const;
    expect(formatDate(date, "en-US", utc)).toBe("1/31/26");
    expect(formatDate(date, "en-GB", utc)).toBe("31/01/2026");
  });

  it("accepts Date, epoch and ISO string inputs", () => {
    const options = { dateStyle: "medium", timeZone: "UTC" } as const;
    const expected = "Sep 26, 2026";
    expect(formatDate(new Date(now), "en-US", options)).toBe(expected);
    expect(formatDate(now, "en-US", options)).toBe(expected);
    expect(formatDate("2026-09-26T12:00:00Z", "en-US", options)).toBe(expected);
  });

  it("returns an empty string for an invalid date instead of throwing", () => {
    expect(formatDate("not a date", "en")).toBe("");
  });
});

describe("formatNumber", () => {
  it("groups digits per locale", () => {
    expect(formatNumber(1_234_567.5, "en-US")).toBe("1,234,567.5");
    expect(formatNumber(1_234_567.5, "de-DE")).toBe("1.234.567,5");
  });

  it("passes options through", () => {
    expect(formatNumber(0.25, "en", { style: "percent" })).toBe("25%");
  });

  it("returns an empty string for NaN", () => {
    expect(formatNumber(Number.NaN, "en")).toBe("");
  });
});

describe("formatRelativeTime", () => {
  it.each([
    [now - 30 * 1000, "30 seconds ago"],
    [now - 5 * 60 * 1000, "5 minutes ago"],
    [now - 90 * 60 * 1000, "2 hours ago"],
    [now - 24 * 60 * 60 * 1000, "yesterday"],
    [now + 3 * 24 * 60 * 60 * 1000, "in 3 days"],
    [now - 14 * 24 * 60 * 60 * 1000, "2 weeks ago"],
    [now - 400 * 24 * 60 * 60 * 1000, "last year"],
    [now, "now"],
  ])("formats %s relative to now", (value, expected) => {
    expect(formatRelativeTime(value, "en", now)).toBe(expected);
  });

  it("localises the phrase", () => {
    expect(formatRelativeTime(now - 2 * 60 * 60 * 1000, "fr", now)).toBe(
      "il y a 2 heures"
    );
  });

  it("returns an empty string for invalid input", () => {
    expect(formatRelativeTime("nope", "en", now)).toBe("");
  });
});

describe("formatFileSize", () => {
  it.each([
    [0, "0 bytes"],
    [1, "1 byte"],
    [999, "999 bytes"],
    [1000, "1 kB"],
    [1536, "1.5 kB"],
    [2_500_000, "2.5 MB"],
    [3_000_000_000, "3 GB"],
    [5e18, "5,000 PB"],
  ])("formats %d bytes", (bytes, expected) => {
    expect(formatFileSize(bytes, "en")).toBe(expected);
  });

  it("uses the locale's decimal separator", () => {
    expect(formatFileSize(1536, "de")).toBe("1,5 kB");
  });

  it("returns an empty string for negative or non-finite sizes", () => {
    expect(formatFileSize(-1, "en")).toBe("");
    expect(formatFileSize(Number.POSITIVE_INFINITY, "en")).toBe("");
  });
});
