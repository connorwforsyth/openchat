import type { ScheduleRecurrence } from "@workspace/contract/schemas/schedules";

import { parseRrule, type RuleParts } from "./recurrence";
import { type LocalTime, localTime } from "./zoned";

// A recurrence as something a person can say (173), structured so the UI
// turns it into words through Lingui (plurals, weekday names in the locale).
// Pure. Anything we can't say simply is `custom`, and shows the rule.

export interface ClockTime {
  readonly hour: number;
  readonly minute: number;
}

export type RecurrenceMeaning =
  | { readonly at: string; readonly type: "once" }
  | { readonly minutes: number; readonly type: "interval" }
  | {
      readonly every: number;
      readonly time: ClockTime;
      readonly type: "daily";
    }
  | { readonly time: ClockTime; readonly type: "weekdays" }
  | {
      /** 0 is Sunday. */
      readonly days: readonly number[];
      readonly every: number;
      readonly time: ClockTime;
      readonly type: "weekly";
    }
  | {
      readonly day: number;
      readonly every: number;
      readonly time: ClockTime;
      readonly type: "monthly";
    }
  | {
      readonly day: number;
      readonly month: number;
      readonly time: ClockTime;
      readonly type: "yearly";
    }
  | { readonly rule: string; readonly type: "custom" };

const WEEKDAYS = [1, 2, 3, 4, 5];

const one = (values: readonly number[], fallback: number): number | null => {
  if (values.length === 0) {
    return fallback;
  }
  return values.length === 1 ? (values[0] ?? null) : null;
};

const sameDays = (a: readonly number[], b: readonly number[]) =>
  a.length === b.length && a.every((day, index) => day === b[index]);

/** A wall-clock rule (daily and slower) at a single time of day. */
const describeWallClock = (
  rule: string,
  parts: RuleParts,
  start: LocalTime,
  time: { readonly hour: number; readonly minute: number }
): RecurrenceMeaning => {
  const every = parts.interval;
  switch (parts.freq) {
    case "DAILY":
      if (parts.byDay.length === 0) {
        return { every, time, type: "daily" };
      }
      return every === 1 && sameDays(parts.byDay, WEEKDAYS)
        ? { time, type: "weekdays" }
        : { days: parts.byDay, every, time, type: "weekly" };
    case "WEEKLY": {
      const days = parts.byDay.length > 0 ? parts.byDay : [start.weekday];
      return every === 1 && sameDays(days, WEEKDAYS)
        ? { time, type: "weekdays" }
        : { days, every, time, type: "weekly" };
    }
    case "MONTHLY": {
      const day = one(parts.byMonthDay, start.day);
      return day === null
        ? { rule, type: "custom" }
        : { day, every, time, type: "monthly" };
    }
    case "YEARLY": {
      const day = one(parts.byMonthDay, start.day);
      const month = one(parts.byMonth, start.month);
      return day === null || month === null || every !== 1
        ? { rule, type: "custom" }
        : { day, month, time, type: "yearly" };
    }
    default:
      return { rule, type: "custom" };
  }
};

const CRON_NUMBER = /^\d{1,2}$/;
const CRON_STEP = /^\*\/(\d{1,2})$/;

const cronNumber = (field: string | undefined, max: number): number | null => {
  if (!(field && CRON_NUMBER.test(field))) {
    return null;
  }
  const value = Number(field);
  return value <= max ? value : null;
};

const cronDays = (field: string): readonly number[] | null => {
  if (field === "1-5") {
    return WEEKDAYS;
  }
  const days = field.split(",").map((part) => cronNumber(part, 7));
  if (days.some((day) => day === null)) {
    return null;
  }
  return [...new Set(days.map((day) => (day ?? 0) % 7))].sort((a, b) => a - b);
};

/**
 * A five-field cron (schedules from before 173) as a simple rule when it is
 * one: every n minutes, hourly, daily, weekdays or set weekdays.
 */
const describeCron = (cron: string): RecurrenceMeaning => {
  const rule = cron.trim().replace(/\s+/g, " ");
  const custom: RecurrenceMeaning = { rule, type: "custom" };
  const [minuteField, hourField, dayOfMonth, month, dayOfWeek, ...rest] =
    rule.split(" ");
  if (rest.length > 0 || dayOfMonth !== "*" || month !== "*" || !dayOfWeek) {
    return custom;
  }
  const step = CRON_STEP.exec(minuteField ?? "");
  if (step && hourField === "*" && dayOfWeek === "*") {
    return { minutes: Number(step[1]), type: "interval" };
  }
  const minute = cronNumber(minuteField, 59);
  if (minute === null) {
    return custom;
  }
  if (hourField === "*" && dayOfWeek === "*" && minute === 0) {
    return { minutes: 60, type: "interval" };
  }
  const hour = cronNumber(hourField, 23);
  if (hour === null) {
    return custom;
  }
  const time = { hour, minute };
  if (dayOfWeek === "*") {
    return { every: 1, time, type: "daily" };
  }
  const days = cronDays(dayOfWeek);
  if (days === null) {
    return custom;
  }
  return sameDays(days, WEEKDAYS)
    ? { time, type: "weekdays" }
    : { days, every: 1, time, type: "weekly" };
};

export const describeRecurrence = (
  recurrence: ScheduleRecurrence
): RecurrenceMeaning => {
  if (recurrence.kind === "cron") {
    return describeCron(recurrence.cron);
  }
  const parsed = parseRrule(recurrence.rrule);
  if (!parsed.ok) {
    return { rule: recurrence.rrule, type: "custom" };
  }
  const parts = parsed.value;
  if (parts.count === 1) {
    return { at: recurrence.startAt, type: "once" };
  }
  if (parts.freq === "MINUTELY" || parts.freq === "HOURLY") {
    return {
      minutes: parts.interval * (parts.freq === "HOURLY" ? 60 : 1),
      type: "interval",
    };
  }
  const start = localTime(new Date(recurrence.startAt), recurrence.timezone);
  const hour = one(parts.byHour, start.hour);
  const minute = one(parts.byMinute, start.minute);
  if (hour === null || minute === null) {
    return { rule: recurrence.rrule, type: "custom" };
  }
  return describeWallClock(recurrence.rrule, parts, start, { hour, minute });
};
