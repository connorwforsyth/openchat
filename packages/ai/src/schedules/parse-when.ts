import type { ScheduleRecurrence } from "@workspace/contract/schemas/schedules";
import { err, ok, type Result } from "@workspace/shared/result";

import { formatRrule, type RuleParts } from "./recurrence";
import { fromLocal, localTime } from "./zoned";

// "Every weekday at 8am" → an RRULE (173). A small, pure parser for the
// schedule editor's "When" field, English only, no model call: it covers
// the phrasings people type for a recurring task and says so when it
// can't. The chat path doesn't need it (the model proposes a rule, the
// user applies the card), so anything cleverer belongs there.

export type ParseWhenError =
  | { readonly type: "unrecognised" }
  | {
      readonly type: "in_past";
    };

interface Context {
  readonly now: Date;
  readonly timezone: string;
}

const DAY_NAMES: readonly (readonly string[])[] = [
  ["sunday", "sun", "sundays"],
  ["monday", "mon", "mondays"],
  ["tuesday", "tue", "tues", "tuesdays"],
  ["wednesday", "wed", "wednesdays"],
  ["thursday", "thu", "thur", "thurs", "thursdays"],
  ["friday", "fri", "fridays"],
  ["saturday", "sat", "saturdays"],
];

const dayOf = (word: string): number =>
  DAY_NAMES.findIndex((names) => names.includes(word));

const NUMBER_WORDS: Readonly<Record<string, number>> = {
  a: 1,
  an: 1,
  eight: 8,
  five: 5,
  four: 4,
  one: 1,
  other: 2,
  six: 6,
  ten: 10,
  three: 3,
  twelve: 12,
  two: 2,
};

const count = (word: string | undefined): number | null => {
  if (word === undefined) {
    return 1;
  }
  const value = NUMBER_WORDS[word] ?? Number(word);
  return Number.isInteger(value) && value > 0 ? value : null;
};

interface Clock {
  readonly hour: number;
  readonly minute: number;
}

const TIME =
  /\b(at\s+)?(noon|midday|midnight|(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?)(?![\w:])/g;

const NAMED_TIMES: Readonly<Record<string, Clock>> = {
  afternoon: { hour: 14, minute: 0 },
  evening: { hour: 18, minute: 0 },
  morning: { hour: 8, minute: 0 },
  night: { hour: 21, minute: 0 },
};

const clockOf = (match: RegExpMatchArray): Clock | null => {
  const [, , word] = match;
  if (word === "noon" || word === "midday") {
    return { hour: 12, minute: 0 };
  }
  if (word === "midnight") {
    return { hour: 0, minute: 0 };
  }
  const meridiem = match[5]?.replace(/\./g, "");
  // A bare number is a time only after "at" ("at 9"), never "every 2 hours".
  if (!(match[1] || meridiem || match[4] !== undefined)) {
    return null;
  }
  let hour = Number(match[3]);
  const minute = Number(match[4] ?? "0");
  if (meridiem === "pm" && hour < 12) {
    hour += 12;
  }
  if (meridiem === "am" && hour === 12) {
    hour = 0;
  }
  return hour <= 23 && minute <= 59 ? { hour, minute } : null;
};

/** A time of day in the text, and the text without it. */
const takeTime = (
  text: string
): { readonly clock: Clock | null; readonly rest: string } => {
  for (const match of text.matchAll(TIME)) {
    const clock = clockOf(match);
    if (clock) {
      const at = match.index ?? 0;
      return {
        clock,
        rest: `${text.slice(0, at)} ${text.slice(at + match[0].length)}`,
      };
    }
  }
  for (const [word, clock] of Object.entries(NAMED_TIMES)) {
    const named = new RegExp(`\\b${word}s?\\b`);
    if (named.test(text)) {
      return { clock, rest: text.replace(named, " ") };
    }
  }
  return { clock: null, rest: text };
};

const rule = (
  parts: Partial<RuleParts> & Pick<RuleParts, "freq">,
  context: Context
): ScheduleRecurrence => ({
  endsAt: null,
  kind: "rrule",
  rrule: formatRrule({
    byDay: [],
    byHour: [],
    byMinute: [],
    byMonth: [],
    byMonthDay: [],
    count: null,
    interval: 1,
    ...parts,
  }),
  startAt: context.now.toISOString(),
  timezone: context.timezone,
});

const once = (at: Date, context: Context): ScheduleRecurrence => ({
  endsAt: null,
  kind: "rrule",
  rrule: "FREQ=DAILY;COUNT=1",
  startAt: at.toISOString(),
  timezone: context.timezone,
});

const DEFAULT_CLOCK: Clock = { hour: 9, minute: 0 };

const atClock = (clock: Clock) => ({
  byHour: [clock.hour],
  byMinute: [clock.minute],
});

const squash = (text: string) => text.replace(/\s+/g, " ").trim();

const ISO_DATE = /\b(\d{4})-(\d{2})-(\d{2})\b/;
const ORDINAL = /\b(?:on\s+)?(?:the\s+)?(\d{1,2})(?:st|nd|rd|th)?\b/;
const RELATIVE =
  /\bin\s+(\d+|a|an|one|two|three|five|ten)\s+(minute|min|hour|hr|day)s?\b/;
const INTERVAL =
  /\bevery\s+(?:(\d+|a|an|one|two|three|four|five|six|eight|ten|twelve|other)\s+)?(minute|min|hour|hr)s?\b/;
const HOURLY = /\bhourly\b/;
const REPEATING =
  /\bevery\b|\bdaily\b|\bweekly\b|\bmonthly\b|\byearly\b|\bweekdays\b/;
const TOMORROW = /\btomorrow\b/;
const TODAY = /\btoday\b|\btonight\b/;
const NEXT_DAY = /\b(?:next|on|this)\s+([a-z]+)\b/;
const WEEKDAYS =
  /\bweekdays?\b|\bevery work ?day\b|\bmonday to friday\b|\bmon-fri\b/;
const WEEKENDS = /\bweekends?\b/;
const WORD_SPLIT = /\s|\band\b/;
const FORTNIGHTLY =
  /\bevery\s+(other|2|two)\s+(week|monday|tuesday|wednesday|thursday|friday|saturday|sunday)s?\b|\bfortnightly\b/;
const EVERY_N_DAYS = /\bevery\s+(\d+|two|three|other)\s+days?\b/;
const WEEKLY = /\bweekly\b|\bevery\s+week\b|\bfortnightly\b/;
const MONTHLY = /\bmonthly\b|\bevery\s+month\b/;
const YEARLY = /\byearly\b|\bannually\b|\bevery\s+year\b/;
const DAILY =
  /\bdaily\b|\bevery\s+day\b|\beach\s+day\b|\bevery\s+(morning|evening|night|afternoon)\b|\beveryday\b/;
const EVERY = /\bevery\b/;

type Parsed = Result<ScheduleRecurrence, ParseWhenError>;

const unitMs = (unit: string | undefined): number => {
  if (unit?.startsWith("h")) {
    return 3_600_000;
  }
  return unit === "day" ? 86_400_000 : 60_000;
};

/** "in 2 hours", "every 15 minutes", "hourly": phrases with no time of day. */
const parseShortInterval = (text: string, context: Context): Parsed | null => {
  const relative = RELATIVE.exec(text);
  if (relative) {
    const amount = count(relative[1]) ?? 1;
    const unit = unitMs(relative[2]);
    return ok(once(new Date(context.now.getTime() + amount * unit), context));
  }

  const interval = INTERVAL.exec(text);
  if (interval) {
    const amount = count(interval[1]);
    if (amount === null) {
      return err({ type: "unrecognised" });
    }
    return ok(
      rule(
        {
          freq: interval[2]?.startsWith("h") ? "HOURLY" : "MINUTELY",
          interval: amount,
        },
        context
      )
    );
  }
  if (HOURLY.test(text)) {
    return ok(rule({ freq: "HOURLY" }, context));
  }
  return null;
};

interface DayContext {
  readonly clock: Clock | null;
  readonly context: Context;
  readonly local: ReturnType<typeof localTime>;
  readonly time: Clock;
  readonly words: string;
}

const onceAt = (at: Date, context: Context): Parsed =>
  at.getTime() <= context.now.getTime()
    ? err({ type: "in_past" })
    : ok(once(at, context));

/** One-offs on a day: today, tonight, tomorrow, an ISO date, "next friday". */
const parseOneOff = ({
  clock,
  context,
  local,
  time,
  words,
}: DayContext): Parsed | null => {
  const onDay = (offsetDays: number): Parsed => {
    const base = new Date(
      Date.UTC(local.year, local.month - 1, local.day + offsetDays)
    );
    const at = fromLocal(
      {
        day: base.getUTCDate(),
        hour: time.hour,
        minute: time.minute,
        month: base.getUTCMonth() + 1,
        year: base.getUTCFullYear(),
      },
      context.timezone
    );
    return onceAt(at, context);
  };
  if (TOMORROW.test(words)) {
    return onDay(1);
  }
  if (TODAY.test(words)) {
    return onDay(0);
  }
  const iso = ISO_DATE.exec(words);
  if (iso) {
    const at = fromLocal(
      {
        day: Number(iso[3]),
        hour: time.hour,
        minute: time.minute,
        month: Number(iso[2]),
        year: Number(iso[1]),
      },
      context.timezone
    );
    return onceAt(at, context);
  }
  const next = NEXT_DAY.exec(words);
  const named = next?.[1] ?? "";
  // "on mondays" repeats; "on monday" is the next one.
  const plural = DAY_NAMES.some((names) => names.at(-1) === named);
  const nextDay = plural ? -1 : dayOf(named);
  if (nextDay >= 0) {
    const ahead = (nextDay - local.weekday + 7) % 7 || 7;
    return onDay(ahead);
  }
  if (clock && words === "") {
    // "at 5pm": the next 5pm.
    const today = onDay(0);
    return today.ok ? today : onDay(1);
  }
  return null;
};

/** Weekly shapes: weekdays, weekends, named days, "weekly", "fortnightly". */
const parseWeekly = ({
  context,
  local,
  time,
  words,
}: DayContext): Parsed | null => {
  if (WEEKDAYS.test(words)) {
    return ok(
      rule(
        { byDay: [1, 2, 3, 4, 5], freq: "WEEKLY", ...atClock(time) },
        context
      )
    );
  }
  if (WEEKENDS.test(words)) {
    return ok(
      rule({ byDay: [0, 6], freq: "WEEKLY", ...atClock(time) }, context)
    );
  }

  const days = words
    .split(WORD_SPLIT)
    .map((word) => dayOf(word))
    .filter((day) => day >= 0);
  const fortnightly = FORTNIGHTLY.test(words);
  if (days.length > 0) {
    return ok(
      rule(
        {
          byDay: [...new Set(days)].sort((a, b) => a - b),
          freq: "WEEKLY",
          interval: fortnightly ? 2 : 1,
          ...atClock(time),
        },
        context
      )
    );
  }
  const everyNDays = EVERY_N_DAYS.exec(words);
  if (everyNDays) {
    return ok(
      rule(
        {
          freq: "DAILY",
          interval: count(everyNDays[1]) ?? 1,
          ...atClock(time),
        },
        context
      )
    );
  }
  if (WEEKLY.test(words)) {
    return ok(
      rule(
        {
          byDay: [local.weekday],
          freq: "WEEKLY",
          interval: fortnightly ? 2 : 1,
          ...atClock(time),
        },
        context
      )
    );
  }
  return null;
};

/** Monthly, yearly and daily shapes. */
const parseLonger = (
  text: string,
  { clock, context, local, time, words }: DayContext
): Parsed => {
  if (MONTHLY.test(words)) {
    const day = ORDINAL.exec(words.replace(MONTHLY, " "));
    const dayOfMonth = day?.[1] ? Number(day[1]) : local.day;
    return dayOfMonth >= 1 && dayOfMonth <= 31
      ? ok(
          rule(
            { byMonthDay: [dayOfMonth], freq: "MONTHLY", ...atClock(time) },
            context
          )
        )
      : err({ type: "unrecognised" });
  }
  if (YEARLY.test(words)) {
    return ok(
      rule(
        {
          byMonth: [local.month],
          byMonthDay: [local.day],
          freq: "YEARLY",
          ...atClock(time),
        },
        context
      )
    );
  }
  if (DAILY.test(text) || (clock && EVERY.test(words))) {
    return ok(rule({ freq: "DAILY", ...atClock(time) }, context));
  }
  return err({ type: "unrecognised" });
};

/**
 * The recurrence a phrase describes, in `timezone`, anchored at `now`.
 * One-offs ("tomorrow at 9", "in 2 hours", "on 2026-11-03 at 10:00")
 * come back as `COUNT=1` rules; a one-off in the past is `in_past`.
 */
export const parseWhen = (input: string, context: Context): Parsed => {
  const text = ` ${input.toLowerCase().replace(/[,!?]/g, " ")} `;
  const short = parseShortInterval(text, context);
  if (short) {
    return short;
  }

  const { clock, rest } = takeTime(text);
  const day: DayContext = {
    clock,
    context,
    local: localTime(context.now, context.timezone),
    time: clock ?? DEFAULT_CLOCK,
    words: squash(rest),
  };
  if (!REPEATING.test(day.words)) {
    const oneOff = parseOneOff(day);
    if (oneOff) {
      return oneOff;
    }
  }
  return parseWeekly(day) ?? parseLonger(text, day);
};
