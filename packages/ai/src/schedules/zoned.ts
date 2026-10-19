// Wall-clock arithmetic in an IANA time zone, on `Intl` alone (173). Pure.

export interface LocalTime {
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
  /** 1–12. */
  readonly month: number;
  /** 0 is Sunday, as in cron and `Date#getDay`. */
  readonly weekday: number;
  readonly year: number;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

const formatterFor = (timeZone: string): Intl.DateTimeFormat => {
  const cached = formatters.get(timeZone);
  if (cached) {
    return cached;
  }
  const made = new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    hour: "numeric",
    hourCycle: "h23",
    minute: "numeric",
    month: "numeric",
    timeZone,
    weekday: "short",
    year: "numeric",
  });
  formatters.set(timeZone, made);
  return made;
};

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Whether `tz` is an IANA zone this runtime knows. */
export const isTimeZone = (tz: string): boolean => {
  try {
    formatterFor(tz);
    return true;
  } catch {
    return false;
  }
};

/** What a clock on the wall in `timeZone` shows at `at`. */
export const localTime = (at: Date, timeZone: string): LocalTime => {
  const parts: Partial<Record<string, string>> = {};
  for (const part of formatterFor(timeZone).formatToParts(at)) {
    parts[part.type] = part.value;
  }
  return {
    day: Number(parts.day),
    hour: Number(parts.hour) % 24,
    minute: Number(parts.minute),
    month: Number(parts.month),
    weekday: WEEKDAYS.indexOf(parts.weekday ?? "Sun"),
    year: Number(parts.year),
  };
};

const asUtc = (local: Omit<LocalTime, "weekday">): number =>
  Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute);

/**
 * The instant a wall clock in `timeZone` shows this local time. In a DST
 * gap (02:30 on spring-forward) it lands just after the gap, like cron.
 */
export const fromLocal = (
  local: Omit<LocalTime, "weekday">,
  timeZone: string
): Date => {
  const wanted = asUtc(local);
  let guess = wanted;
  // Two passes settle the offset, a third covers a DST edge.
  for (let pass = 0; pass < 3; pass += 1) {
    const shown = asUtc(localTime(new Date(guess), timeZone));
    if (shown === wanted) {
      return new Date(guess);
    }
    guess += wanted - shown;
  }
  return new Date(guess);
};

const DAY_MS = 86_400_000;

/** Whole calendar days from `a` to `b` (local dates). */
export const daysBetween = (
  a: Pick<LocalTime, "day" | "month" | "year">,
  b: Pick<LocalTime, "day" | "month" | "year">
): number =>
  Math.round(
    (Date.UTC(b.year, b.month - 1, b.day) -
      Date.UTC(a.year, a.month - 1, a.day)) /
      DAY_MS
  );

/** Whole weeks (Monday-based) from `a`'s week to `b`'s. */
export const weeksBetween = (a: LocalTime, b: LocalTime): number => {
  const mondayOffset = (weekday: number) => (weekday + 6) % 7;
  const aMonday =
    daysBetween({ day: 1, month: 1, year: 2000 }, a) - mondayOffset(a.weekday);
  const bMonday =
    daysBetween({ day: 1, month: 1, year: 2000 }, b) - mondayOffset(b.weekday);
  return Math.round((bMonday - aMonday) / 7);
};

export const monthsBetween = (
  a: Pick<LocalTime, "month" | "year">,
  b: Pick<LocalTime, "month" | "year">
): number => (b.year - a.year) * 12 + (b.month - a.month);
