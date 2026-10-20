import type { ScheduleRecurrence } from "@workspace/contract/schemas/schedules";
import { err, ok, type Result } from "@workspace/shared/result";
import { CronExpressionParser } from "cron-parser";

import {
  daysBetween,
  isTimeZone,
  type LocalTime,
  localTime,
  monthsBetween,
  weeksBetween,
} from "./zoned";

// When a schedule fires (173). A recurrence is an RRULE (RFC 5545, a subset)
// or a five-field cron, in an IANA zone. Wall-clock rules (daily, weekly,
// monthly, yearly) compile to cron and expand through cron-parser, which
// keeps 09:00 at 09:00 across DST; MINUTELY and HOURLY count elapsed time
// from `startAt`, as ChatGPT's interval schedules do. Pure: the server
// stores what this computes, the web shows what it says.

export type Frequency =
  | "MINUTELY"
  | "HOURLY"
  | "DAILY"
  | "WEEKLY"
  | "MONTHLY"
  | "YEARLY";

const FREQUENCIES: readonly Frequency[] = [
  "MINUTELY",
  "HOURLY",
  "DAILY",
  "WEEKLY",
  "MONTHLY",
  "YEARLY",
];

/** RRULE weekday codes, indexed by cron's weekday (0 is Sunday). */
export const RRULE_DAYS = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"] as const;

export interface RuleParts {
  readonly byDay: readonly number[];
  readonly byHour: readonly number[];
  readonly byMinute: readonly number[];
  readonly byMonth: readonly number[];
  readonly byMonthDay: readonly number[];
  /** `COUNT=1`: once, at `startAt`. */
  readonly count: 1 | null;
  readonly freq: Frequency;
  readonly interval: number;
}

export type RecurrenceError =
  | { readonly message: string; readonly type: "invalid_rule" }
  | { readonly message: string; readonly type: "invalid_timezone" };

const invalid = (message: string): Result<never, RecurrenceError> =>
  err({ message, type: "invalid_rule" });

const numbers = (
  value: string,
  min: number,
  max: number
): readonly number[] | null => {
  const list = value.split(",").map((each) => Number(each));
  return list.every(
    (each) => Number.isInteger(each) && each >= min && each <= max
  )
    ? [...new Set(list)].sort((a, b) => a - b)
    : null;
};

const RRULE_PREFIX = /^RRULE:/i;
const DIGITS = /^\d+$/;
const WHITESPACE = /\s+/;

type MutableParts = { -readonly [K in keyof RuleParts]: RuleParts[K] };

/** Sets one RRULE field on `parts`; an error if the field is unsupported. */
const applyField = (
  parts: MutableParts,
  key: string,
  value: string
): Result<never, RecurrenceError> | null => {
  switch (key) {
    case "FREQ":
      return null;
    case "INTERVAL": {
      const interval = Number(value);
      if (!Number.isInteger(interval) || interval < 1 || interval > 1000) {
        return invalid("INTERVAL must be a whole number from 1 to 1000.");
      }
      parts.interval = interval;
      return null;
    }
    case "COUNT":
      if (value !== "1") {
        return invalid("Only COUNT=1 (a one-off) is supported.");
      }
      parts.count = 1;
      return null;
    case "BYDAY": {
      const days = value
        .split(",")
        .map((day) => RRULE_DAYS.indexOf(day as (typeof RRULE_DAYS)[number]));
      if (days.some((day) => day < 0)) {
        return invalid("BYDAY takes MO, TU, WE, TH, FR, SA, SU (no ordinals).");
      }
      parts.byDay = [...new Set(days)].sort((a, b) => a - b);
      return null;
    }
    case "BYHOUR": {
      const hours = numbers(value, 0, 23);
      if (!hours) {
        return invalid("BYHOUR takes 0–23.");
      }
      parts.byHour = hours;
      return null;
    }
    case "BYMINUTE": {
      const minutes = numbers(value, 0, 59);
      if (!minutes) {
        return invalid("BYMINUTE takes 0–59.");
      }
      parts.byMinute = minutes;
      return null;
    }
    case "BYMONTHDAY": {
      const days = numbers(value, 1, 31);
      if (!days) {
        return invalid("BYMONTHDAY takes 1–31.");
      }
      parts.byMonthDay = days;
      return null;
    }
    case "BYMONTH": {
      const months = numbers(value, 1, 12);
      if (!months) {
        return invalid("BYMONTH takes 1–12.");
      }
      parts.byMonth = months;
      return null;
    }
    default:
      return invalid(`${key} isn't supported.`);
  }
};

const fieldsOf = (
  body: string
): Result<Map<string, string>, RecurrenceError> => {
  const fields = new Map<string, string>();
  for (const pair of body.split(";")) {
    if (pair.trim() === "") {
      continue;
    }
    const [key, value] = pair.split("=");
    if (!(key && value)) {
      return invalid(`"${pair}" isn't KEY=VALUE.`);
    }
    fields.set(key.trim().toUpperCase(), value.trim().toUpperCase());
  }
  return ok(fields);
};

/** The RRULE's parts, or why we don't support it. */
export const parseRrule = (
  rule: string
): Result<RuleParts, RecurrenceError> => {
  const parsedFields = fieldsOf(rule.trim().replace(RRULE_PREFIX, ""));
  if (!parsedFields.ok) {
    return parsedFields;
  }
  const fields = parsedFields.value;
  const freq = fields.get("FREQ") as Frequency | undefined;
  if (!(freq && FREQUENCIES.includes(freq))) {
    return invalid(
      "FREQ must be MINUTELY, HOURLY, DAILY, WEEKLY, MONTHLY or YEARLY."
    );
  }
  const parts: MutableParts = {
    byDay: [],
    byHour: [],
    byMinute: [],
    byMonth: [],
    byMonthDay: [],
    count: null,
    freq,
    interval: 1,
  };
  for (const [key, value] of fields) {
    const failure = applyField(parts, key, value);
    if (failure) {
      return failure;
    }
  }
  const elapsed = freq === "MINUTELY" || freq === "HOURLY";
  if (
    elapsed &&
    parts.count === null &&
    (parts.byDay.length > 0 ||
      parts.byHour.length > 0 ||
      parts.byMonthDay.length > 0 ||
      parts.byMonth.length > 0 ||
      parts.byMinute.length > 0)
  ) {
    return invalid(`${freq} counts from the start time and takes no BY parts.`);
  }
  return ok(parts);
};

/** The RRULE text for parts (the inverse of `parseRrule`), in a stable order. */
export const formatRrule = (parts: RuleParts): string =>
  [
    `FREQ=${parts.freq}`,
    parts.interval > 1 ? `INTERVAL=${parts.interval}` : null,
    parts.count ? "COUNT=1" : null,
    parts.byMonth.length > 0 ? `BYMONTH=${parts.byMonth.join(",")}` : null,
    parts.byMonthDay.length > 0
      ? `BYMONTHDAY=${parts.byMonthDay.join(",")}`
      : null,
    parts.byDay.length > 0
      ? `BYDAY=${parts.byDay.map((day) => RRULE_DAYS[day]).join(",")}`
      : null,
    parts.byHour.length > 0 ? `BYHOUR=${parts.byHour.join(",")}` : null,
    parts.byMinute.length > 0 ? `BYMINUTE=${parts.byMinute.join(",")}` : null,
  ]
    .filter(Boolean)
    .join(";");

const FIVE_FIELDS = /^\s*(\S+\s+){4}\S+\s*$/;

const cronFor = (parts: RuleParts, start: LocalTime): string => {
  const list = (values: readonly number[], fallback: number) =>
    values.length > 0 ? values.join(",") : String(fallback);
  const minute = list(parts.byMinute, start.minute);
  const hour = list(parts.byHour, start.hour);
  switch (parts.freq) {
    case "DAILY":
      return `${minute} ${hour} * * ${parts.byDay.length > 0 ? parts.byDay.join(",") : "*"}`;
    case "WEEKLY":
      return `${minute} ${hour} * * ${list(parts.byDay, start.weekday)}`;
    case "MONTHLY":
      return `${minute} ${hour} ${list(parts.byMonthDay, start.day)} * *`;
    case "YEARLY":
      return `${minute} ${hour} ${list(parts.byMonthDay, start.day)} ${list(parts.byMonth, start.month)} *`;
    default:
      return `${minute} ${hour} * * *`;
  }
};

const onInterval = (
  parts: RuleParts,
  start: LocalTime,
  candidate: LocalTime
): boolean => {
  if (parts.interval === 1) {
    return true;
  }
  const n = parts.interval;
  switch (parts.freq) {
    case "DAILY":
      return daysBetween(start, candidate) % n === 0;
    case "WEEKLY":
      return weeksBetween(start, candidate) % n === 0;
    case "MONTHLY":
      return monthsBetween(start, candidate) % n === 0;
    case "YEARLY":
      return (candidate.year - start.year) % n === 0;
    default:
      return true;
  }
};

/** Cron occurrences we'll look through for an INTERVAL>1 match before giving up. */
const MAX_SCAN = 2000;

const cronAfter = (
  cron: string,
  timezone: string,
  after: Date,
  accept: (at: Date) => boolean = () => true
): Result<Date | null, RecurrenceError> => {
  if (!FIVE_FIELDS.test(cron)) {
    return invalid("Use five fields: minute hour day month weekday.");
  }
  try {
    const expression = CronExpressionParser.parse(cron, {
      currentDate: after,
      strict: false,
      tz: timezone,
    });
    for (let scanned = 0; scanned < MAX_SCAN; scanned += 1) {
      const next = expression.next().toDate();
      if (accept(next)) {
        return ok(next);
      }
    }
    return ok(null);
  } catch (cause) {
    return invalid(cause instanceof Error ? cause.message : "Invalid cron.");
  }
};

const capAtEnd = (next: Date | null, endsAt: string | null): Date | null =>
  next && endsAt && next.getTime() > new Date(endsAt).getTime() ? null : next;

/**
 * The first nominal slot strictly after `after`, or `null` when there's no
 * other (a one-off already past, or past `endsAt`). A bad rule or zone is an
 * error value, so the API can point at it.
 */
export const nextNominal = (
  recurrence: ScheduleRecurrence,
  after: Date
): Result<Date | null, RecurrenceError> => {
  if (!isTimeZone(recurrence.timezone)) {
    return err({
      message: `Unknown time zone: ${recurrence.timezone}`,
      type: "invalid_timezone",
    });
  }
  if (recurrence.kind === "cron") {
    const next = cronAfter(recurrence.cron, recurrence.timezone, after);
    return next.ok ? ok(capAtEnd(next.value, recurrence.endsAt)) : next;
  }
  const parts = parseRrule(recurrence.rrule);
  if (!parts.ok) {
    return parts;
  }
  const startAt = new Date(recurrence.startAt);
  if (parts.value.count === 1) {
    return ok(startAt.getTime() > after.getTime() ? startAt : null);
  }
  if (parts.value.freq === "MINUTELY" || parts.value.freq === "HOURLY") {
    const step =
      parts.value.interval * (parts.value.freq === "HOURLY" ? 60 : 1) * 60_000;
    const steps =
      after.getTime() < startAt.getTime()
        ? 0
        : Math.floor((after.getTime() - startAt.getTime()) / step) + 1;
    return ok(
      capAtEnd(new Date(startAt.getTime() + steps * step), recurrence.endsAt)
    );
  }
  const start = localTime(startAt, recurrence.timezone);
  // Never before the anchor: "every other week from today".
  const from =
    after.getTime() < startAt.getTime()
      ? new Date(startAt.getTime() - 1)
      : after;
  const next = cronAfter(
    cronFor(parts.value, start),
    recurrence.timezone,
    from,
    (at) => onInterval(parts.value, start, localTime(at, recurrence.timezone))
  );
  return next.ok ? ok(capAtEnd(next.value, recurrence.endsAt)) : next;
};

/** Whether the rule is a one-off. */
export const isOnce = (recurrence: ScheduleRecurrence): boolean => {
  if (recurrence.kind !== "rrule") {
    return false;
  }
  const parts = parseRrule(recurrence.rrule);
  return parts.ok && parts.value.count === 1;
};

/**
 * The shortest gap between the next few slots after `now`, in minutes, for
 * the minimum-interval guardrail. `null` for a one-off (it never repeats).
 */
export const shortestGapMinutes = (
  recurrence: ScheduleRecurrence,
  now: Date,
  sample = 8
): Result<number | null, RecurrenceError> => {
  if (isOnce(recurrence)) {
    return ok(null);
  }
  const slots: Date[] = [];
  let cursor = now;
  for (let index = 0; index < sample; index += 1) {
    const next = nextNominal({ ...recurrence, endsAt: null }, cursor);
    if (!next.ok) {
      return next;
    }
    if (!next.value) {
      break;
    }
    slots.push(next.value);
    cursor = next.value;
  }
  let shortest: number | null = null;
  for (let index = 1; index < slots.length; index += 1) {
    const gap =
      ((slots[index]?.getTime() ?? 0) - (slots[index - 1]?.getTime() ?? 0)) /
      60_000;
    shortest = shortest === null ? gap : Math.min(shortest, gap);
  }
  return ok(shortest);
};

/**
 * How many nominal slots fell strictly between `from` and `now`, beyond the
 * one being fired: the overdue slots that collapse into it after downtime.
 */
export const missedSlotsBetween = (
  recurrence: ScheduleRecurrence,
  from: Date,
  now: Date,
  limit = 1000
): number => {
  let count = 0;
  let cursor = from;
  while (count < limit) {
    const next = nextNominal(recurrence, cursor);
    if (!(next.ok && next.value) || next.value.getTime() > now.getTime()) {
      return count;
    }
    count += 1;
    cursor = next.value;
  }
  return count;
};

/** Half the jitter window: ±5 minutes, like ChatGPT's scheduler. */
export const JITTER_SECONDS = 300;

const fnv1a = (text: string): number => {
  let hash = 0x81_1c_9d_c5;
  for (let index = 0; index < text.length; index += 1) {
    // biome-ignore lint/suspicious/noBitwiseOperators: FNV-1a is defined by XOR.
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01_00_01_93);
  }
  // biome-ignore lint/suspicious/noBitwiseOperators: unsigned 32-bit result.
  return hash >>> 0;
};

/**
 * When a slot actually fires. Wall-clock and hourly rules that land on a
 * round minute (:00, :05, …) get a deterministic offset of up to ±5 minutes
 * from the schedule id and the slot, so a thousand "daily at 9:00"
 * schedules don't all wake at 9:00:00. One-offs and odd minutes fire on
 * the dot. Show the nominal time; fire at this one.
 */
export const jitteredAt = (
  scheduleId: string,
  recurrence: ScheduleRecurrence,
  nominal: Date
): Date => {
  if (isOnce(recurrence) || nominal.getUTCMinutes() % 5 !== 0) {
    return nominal;
  }
  if (recurrence.kind === "rrule") {
    const parts = parseRrule(recurrence.rrule);
    if (parts.ok && parts.value.freq === "MINUTELY") {
      return nominal;
    }
  } else if (!DIGITS.test(recurrence.cron.trim().split(WHITESPACE)[0] ?? "")) {
    // `*` or `*/5` in the minute field: frequent, and jitter would reorder it.
    return nominal;
  }
  const span = JITTER_SECONDS * 2 + 1;
  const offset =
    (fnv1a(`${scheduleId}:${nominal.toISOString()}`) % span) - JITTER_SECONDS;
  return new Date(nominal.getTime() + offset * 1000);
};

/** Whether a rule fires more often than `minMinutes`: the guardrail at create and update. */
export const tooFrequent = (
  recurrence: ScheduleRecurrence,
  now: Date,
  minMinutes: number
): Result<boolean, RecurrenceError> => {
  const gap = shortestGapMinutes(recurrence, now);
  if (!gap.ok) {
    return gap;
  }
  return ok(gap.value !== null && gap.value < minMinutes);
};

/** A one-off no more than this far out, as ChatGPT's editor allows. */
export const ONCE_MAX_DAYS = 731;
