import { describe, expect, it } from "vitest";

import { describeCron, PRESET_CRON, presetOf } from "./schedule";

describe("presets", () => {
  it("round-trips every preset and calls the rest custom", () => {
    for (const [preset, cron] of Object.entries(PRESET_CRON)) {
      expect(presetOf(cron)).toBe(preset);
    }
    expect(presetOf("  0   8 * * * ")).toBe("morning");
    expect(presetOf("15 3 1 * *")).toBe("custom");
  });
});

describe("describeCron", () => {
  it("reads the common shapes", () => {
    expect(describeCron("* * * * *")).toEqual({ type: "every-minute" });
    expect(describeCron("*/15 * * * *")).toEqual({
      minutes: 15,
      type: "every-n-minutes",
    });
    expect(describeCron("5 * * * *")).toEqual({ minute: 5, type: "hourly" });
    expect(describeCron("0 8 * * *")).toEqual({
      hour: 8,
      minute: 0,
      type: "daily",
    });
    expect(describeCron("30 9 * * 1-5")).toEqual({
      hour: 9,
      minute: 30,
      type: "weekdays",
    });
    expect(describeCron("0 9 * * 7")).toEqual({
      day: 0,
      hour: 9,
      minute: 0,
      type: "weekly",
    });
  });

  it("falls back to the expression for anything else", () => {
    expect(describeCron("0 9 1 * *")).toEqual({
      cron: "0 9 1 * *",
      type: "custom",
    });
    expect(describeCron("nonsense")).toMatchObject({ type: "custom" });
    expect(describeCron("0 25 * * *")).toMatchObject({ type: "custom" });
  });
});
