// Friendly schedules for Dots (172): the presets the dialog offers, and a
// cron expression read back as something a person can say. Pure; the screen
// turns a `CronMeaning` into words through Lingui.

export type SchedulePreset =
  | "every-minute"
  | "hourly"
  | "morning"
  | "weekdays"
  | "weekly"
  | "custom";

export const PRESET_CRON: Readonly<
  Record<Exclude<SchedulePreset, "custom">, string>
> = {
  "every-minute": "* * * * *",
  hourly: "0 * * * *",
  morning: "0 8 * * *",
  weekdays: "0 9 * * 1-5",
  weekly: "0 9 * * 1",
};

const SPACES = /\s+/;

const normalise = (cron: string): string => cron.trim().split(SPACES).join(" ");

/** The preset a cron expression is, or `custom`. */
export const presetOf = (cron: string): SchedulePreset => {
  const wanted = normalise(cron);
  const found = Object.entries(PRESET_CRON).find(
    ([, expression]) => expression === wanted
  );
  return found ? (found[0] as SchedulePreset) : "custom";
};

/** What a cron expression means, as far as we can say it simply. */
export type CronMeaning =
  | { readonly type: "every-minute" }
  | { readonly minutes: number; readonly type: "every-n-minutes" }
  | { readonly minute: number; readonly type: "hourly" }
  | { readonly hour: number; readonly minute: number; readonly type: "daily" }
  | {
      readonly hour: number;
      readonly minute: number;
      readonly type: "weekdays";
    }
  | {
      /** 0 is Sunday, as in cron. */
      readonly day: number;
      readonly hour: number;
      readonly minute: number;
      readonly type: "weekly";
    }
  | { readonly cron: string; readonly type: "custom" };

const NUMBER = /^\d{1,2}$/;
const STEP = /^\*\/(\d{1,2})$/;

const num = (field: string | undefined, max: number): number | null => {
  if (field === undefined || !NUMBER.test(field)) {
    return null;
  }
  const value = Number(field);
  return value <= max ? value : null;
};

export const describeCron = (cron: string): CronMeaning => {
  const expression = normalise(cron);
  const fields = expression.split(" ");
  if (fields.length !== 5) {
    return { cron: expression, type: "custom" };
  }
  const [minuteField, hourField, dayOfMonth, month, dayOfWeek] = fields;
  const everyDay = dayOfMonth === "*" && month === "*";
  if (!everyDay) {
    return { cron: expression, type: "custom" };
  }
  if (expression === "* * * * *") {
    return { type: "every-minute" };
  }
  const step = STEP.exec(minuteField ?? "");
  if (step && hourField === "*" && dayOfWeek === "*") {
    return { minutes: Number(step[1]), type: "every-n-minutes" };
  }
  const minute = num(minuteField, 59);
  if (minute === null) {
    return { cron: expression, type: "custom" };
  }
  if (hourField === "*" && dayOfWeek === "*") {
    return { minute, type: "hourly" };
  }
  const hour = num(hourField, 23);
  if (hour === null) {
    return { cron: expression, type: "custom" };
  }
  if (dayOfWeek === "*") {
    return { hour, minute, type: "daily" };
  }
  if (dayOfWeek === "1-5") {
    return { hour, minute, type: "weekdays" };
  }
  const day = num(dayOfWeek, 7);
  return day === null
    ? { cron: expression, type: "custom" }
    : { day: day % 7, hour, minute, type: "weekly" };
};

/** The browser's IANA zone, or UTC when it won't say. */
export const localTimeZone = (): string => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
};
