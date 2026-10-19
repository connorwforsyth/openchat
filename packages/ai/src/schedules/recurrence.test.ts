import type { ScheduleRecurrence } from "@workspace/contract/schemas/schedules";
import { describe, expect, it } from "vitest";

import { describeRecurrence } from "./describe";
import {
  formatRrule,
  isOnce,
  JITTER_SECONDS,
  jitteredAt,
  missedSlotsBetween,
  nextNominal,
  parseRrule,
  shortestGapMinutes,
  tooFrequent,
} from "./recurrence";

const rrule = (
  rule: string,
  timezone = "UTC",
  startAt = "2026-10-01T00:00:00.000Z",
  endsAt: string | null = null
): ScheduleRecurrence => ({
  endsAt,
  kind: "rrule",
  rrule: rule,
  startAt,
  timezone,
});

const next = (recurrence: ScheduleRecurrence, after: string) => {
  const result = nextNominal(recurrence, new Date(after));
  if (!result.ok) {
    throw new Error(result.error.message);
  }
  return result.value?.toISOString() ?? null;
};

describe("parseRrule", () => {
  it("reads the supported parts and writes them back the same", () => {
    const parts = parseRrule(
      "FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,FR;BYHOUR=9;BYMINUTE=30"
    );
    expect(parts.ok && formatRrule(parts.value)).toBe(
      "FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,FR;BYHOUR=9;BYMINUTE=30"
    );
  });

  it.each([
    "FREQ=SECONDLY",
    "FREQ=DAILY;BYSETPOS=1",
    "FREQ=DAILY;COUNT=3",
    "FREQ=MONTHLY;BYDAY=1MO",
    "FREQ=HOURLY;BYMINUTE=5",
    "FREQ=DAILY;BYHOUR=24",
  ])("refuses %s with a reason", (rule) => {
    const parsed = parseRrule(rule);
    expect(parsed.ok).toBe(false);
  });
});

describe("nextNominal", () => {
  it("fires daily at the wall-clock time", () => {
    expect(
      next(rrule("FREQ=DAILY;BYHOUR=8;BYMINUTE=0"), "2026-10-20T08:00:00Z")
    ).toBe("2026-10-21T08:00:00.000Z");
  });

  it("keeps 9:00 London across the October fall-back", () => {
    const rule = rrule("FREQ=DAILY;BYHOUR=9;BYMINUTE=0", "Europe/London");
    // BST (UTC+1) on Saturday 24th, GMT from Sunday 25th.
    expect(next(rule, "2026-10-24T07:00:00Z")).toBe("2026-10-24T08:00:00.000Z");
    expect(next(rule, "2026-10-24T09:00:00Z")).toBe("2026-10-25T09:00:00.000Z");
  });

  it("keeps 9:00 London across the March spring-forward", () => {
    const rule = rrule("FREQ=DAILY;BYHOUR=9;BYMINUTE=0", "Europe/London");
    expect(next(rule, "2027-03-27T10:00:00Z")).toBe("2027-03-28T08:00:00.000Z");
  });

  it("keeps 9:00 New York across both DST changes", () => {
    const rule = rrule("FREQ=DAILY;BYHOUR=9;BYMINUTE=0", "America/New_York");
    expect(next(rule, "2026-10-31T14:00:00Z")).toBe("2026-11-01T14:00:00.000Z");
    expect(next(rule, "2027-03-13T15:00:00Z")).toBe("2027-03-14T13:00:00.000Z");
  });

  it("does weekdays and skips the weekend", () => {
    // Friday 23 Oct 2026, after 9:00.
    expect(
      next(
        rrule("FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR;BYHOUR=9;BYMINUTE=0"),
        "2026-10-23T10:00:00Z"
      )
    ).toBe("2026-10-26T09:00:00.000Z");
  });

  it("does every other week from the start's week", () => {
    // Start Thursday 1 Oct 2026; Mondays in even weeks from then: 12 Oct, 26 Oct.
    const rule = rrule("FREQ=WEEKLY;INTERVAL=2;BYDAY=MO;BYHOUR=9;BYMINUTE=0");
    expect(next(rule, "2026-10-01T00:00:00Z")).toBe("2026-10-12T09:00:00.000Z");
    expect(next(rule, "2026-10-12T09:00:00Z")).toBe("2026-10-26T09:00:00.000Z");
  });

  it("does monthly on a day and yearly on a date", () => {
    expect(
      next(
        rrule("FREQ=MONTHLY;BYMONTHDAY=1;BYHOUR=9;BYMINUTE=0"),
        "2026-10-20T00:00:00Z"
      )
    ).toBe("2026-11-01T09:00:00.000Z");
    expect(
      next(
        rrule("FREQ=YEARLY;BYMONTH=3;BYMONTHDAY=14;BYHOUR=9;BYMINUTE=0"),
        "2026-10-20T00:00:00Z"
      )
    ).toBe("2027-03-14T09:00:00.000Z");
  });

  it("counts intervals as elapsed time from the start", () => {
    const rule = rrule(
      "FREQ=HOURLY;INTERVAL=2",
      "UTC",
      "2026-10-20T08:15:00.000Z"
    );
    expect(next(rule, "2026-10-20T07:00:00Z")).toBe("2026-10-20T08:15:00.000Z");
    expect(next(rule, "2026-10-20T08:15:00Z")).toBe("2026-10-20T10:15:00.000Z");
    expect(next(rule, "2026-10-20T11:00:00Z")).toBe("2026-10-20T12:15:00.000Z");
  });

  it("fires a one-off once and then has no next", () => {
    const rule = rrule("FREQ=DAILY;COUNT=1", "UTC", "2026-10-21T09:00:00.000Z");
    expect(isOnce(rule)).toBe(true);
    expect(next(rule, "2026-10-20T00:00:00Z")).toBe("2026-10-21T09:00:00.000Z");
    expect(next(rule, "2026-10-21T09:00:00Z")).toBeNull();
  });

  it("stops at endsAt", () => {
    const rule = rrule(
      "FREQ=DAILY;BYHOUR=8;BYMINUTE=0",
      "UTC",
      "2026-10-01T00:00:00.000Z",
      "2026-10-21T12:00:00.000Z"
    );
    expect(next(rule, "2026-10-20T09:00:00Z")).toBe("2026-10-21T08:00:00.000Z");
    expect(next(rule, "2026-10-21T09:00:00Z")).toBeNull();
  });

  it("still reads cron, and errors on a bad zone", () => {
    expect(
      next(
        { cron: "0 9 * * 1-5", endsAt: null, kind: "cron", timezone: "UTC" },
        "2026-10-23T10:00:00Z"
      )
    ).toBe("2026-10-26T09:00:00.000Z");
    const bad = nextNominal(rrule("FREQ=DAILY", "Mars/Olympus"), new Date());
    expect(!bad.ok && bad.error.type).toBe("invalid_timezone");
  });
});

describe("guardrail helpers", () => {
  it("measures the shortest gap; a one-off has none", () => {
    const now = new Date("2026-10-20T00:00:00Z");
    const gap = shortestGapMinutes(rrule("FREQ=MINUTELY;INTERVAL=15"), now);
    expect(gap.ok && gap.value).toBe(15);
    const weekdays = shortestGapMinutes(
      rrule("FREQ=WEEKLY;BYDAY=MO,TU;BYHOUR=9;BYMINUTE=0"),
      now
    );
    expect(weekdays.ok && weekdays.value).toBe(24 * 60);
    const once = shortestGapMinutes(rrule("FREQ=DAILY;COUNT=1"), now);
    expect(once.ok && once.value).toBeNull();
  });

  it("flags rules more frequent than the minimum", () => {
    const now = new Date("2026-10-20T00:00:00Z");
    const fast = tooFrequent(rrule("FREQ=MINUTELY;INTERVAL=30"), now, 60);
    const hourly = tooFrequent(rrule("FREQ=HOURLY"), now, 60);
    const cron = tooFrequent(
      { cron: "*/5 * * * *", endsAt: null, kind: "cron", timezone: "UTC" },
      now,
      60
    );
    expect([
      fast.ok && fast.value,
      hourly.ok && hourly.value,
      cron.ok && cron.value,
    ]).toEqual([true, false, true]);
  });

  it("counts the slots missed during downtime", () => {
    const rule = rrule("FREQ=HOURLY", "UTC", "2026-10-20T00:00:00.000Z");
    // Slot 03:00 was due; the server was down until 06:30: 04, 05, 06 missed.
    expect(
      missedSlotsBetween(
        rule,
        new Date("2026-10-20T03:00:00Z"),
        new Date("2026-10-20T06:30:00Z")
      )
    ).toBe(3);
  });
});

describe("jitteredAt", () => {
  const daily = rrule("FREQ=DAILY;BYHOUR=9;BYMINUTE=0");
  const nominal = new Date("2026-10-21T09:00:00Z");

  it("is deterministic and within ±5 minutes on round minutes", () => {
    const a = jitteredAt("schedule-a", daily, nominal);
    expect(jitteredAt("schedule-a", daily, nominal)).toEqual(a);
    expect(Math.abs(a.getTime() - nominal.getTime())).toBeLessThanOrEqual(
      JITTER_SECONDS * 1000
    );
    const offsets = new Set(
      ["a", "b", "c", "d", "e", "f"].map((id) =>
        jitteredAt(id, daily, nominal).getTime()
      )
    );
    expect(offsets.size).toBeGreaterThan(1);
  });

  it("leaves one-offs, odd minutes and minutely rules on the dot", () => {
    expect(jitteredAt("x", rrule("FREQ=DAILY;COUNT=1"), nominal)).toEqual(
      nominal
    );
    const odd = new Date("2026-10-21T09:07:00Z");
    expect(jitteredAt("x", daily, odd)).toEqual(odd);
    expect(
      jitteredAt("x", rrule("FREQ=MINUTELY;INTERVAL=60"), nominal)
    ).toEqual(nominal);
  });
});

describe("describeRecurrence", () => {
  it.each([
    [
      "FREQ=DAILY;BYHOUR=8;BYMINUTE=0",
      { every: 1, time: { hour: 8, minute: 0 }, type: "daily" },
    ],
    [
      "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR;BYHOUR=9;BYMINUTE=0",
      { time: { hour: 9, minute: 0 }, type: "weekdays" },
    ],
    [
      "FREQ=WEEKLY;INTERVAL=2;BYDAY=MO;BYHOUR=9;BYMINUTE=30",
      { days: [1], every: 2, time: { hour: 9, minute: 30 }, type: "weekly" },
    ],
    [
      "FREQ=MONTHLY;BYMONTHDAY=1;BYHOUR=9;BYMINUTE=0",
      { day: 1, every: 1, time: { hour: 9, minute: 0 }, type: "monthly" },
    ],
    ["FREQ=HOURLY;INTERVAL=3", { minutes: 180, type: "interval" }],
    [
      "FREQ=DAILY;BYHOUR=8,20;BYMINUTE=0",
      { rule: "FREQ=DAILY;BYHOUR=8,20;BYMINUTE=0", type: "custom" },
    ],
  ])("says %s simply", (rule, meaning) => {
    expect(describeRecurrence(rrule(rule))).toEqual(meaning);
  });

  it("says a one-off is once, at its time", () => {
    expect(
      describeRecurrence(
        rrule("FREQ=DAILY;COUNT=1", "UTC", "2026-11-03T10:00:00.000Z")
      )
    ).toEqual({
      at: "2026-11-03T10:00:00.000Z",
      type: "once",
    });
  });

  it.each([
    [
      "0 9 * * 1",
      { days: [1], every: 1, time: { hour: 9, minute: 0 }, type: "weekly" },
    ],
    ["30 8 * * 1-5", { time: { hour: 8, minute: 30 }, type: "weekdays" }],
    ["0 7 * * *", { every: 1, time: { hour: 7, minute: 0 }, type: "daily" }],
    ["*/15 * * * *", { minutes: 15, type: "interval" }],
    ["0 * * * *", { minutes: 60, type: "interval" }],
    ["* * * * *", { minutes: 1, type: "interval" }],
    ["0 9 1 * *", { rule: "0 9 1 * *", type: "custom" }],
  ])("says the cron %s simply when it can", (cron, meaning) => {
    expect(
      describeRecurrence({ cron, endsAt: null, kind: "cron", timezone: "UTC" })
    ).toEqual(meaning);
  });
});
