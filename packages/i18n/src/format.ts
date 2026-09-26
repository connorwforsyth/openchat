/**
 * Locale-aware formatting over `Intl`. Pure functions: the caller passes the
 * locale (from the active Lingui instance or `user.locale`), so these work the
 * same on the server, in the browser, in Electron and in React Native.
 *
 * Invalid input formats to an empty string rather than throwing: a bad
 * timestamp in one message must not take the whole conversation down.
 */

type DateInput = Date | number | string;

function toTime(value: DateInput): number {
  return value instanceof Date ? value.getTime() : new Date(value).getTime();
}

export function formatDate(
  value: DateInput,
  locale: string,
  options: Intl.DateTimeFormatOptions = { dateStyle: "medium" }
): string {
  const time = toTime(value);
  if (Number.isNaN(time)) {
    return "";
  }
  return new Intl.DateTimeFormat(locale, options).format(time);
}

export function formatNumber(
  value: number,
  locale: string,
  options?: Intl.NumberFormatOptions
): string {
  if (Number.isNaN(value)) {
    return "";
  }
  return new Intl.NumberFormat(locale, options).format(value);
}

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;
const MONTH = 30 * DAY;
const YEAR = 365 * DAY;

// Largest unit first; the first one the gap reaches is used, so "90 minutes"
// reads as "2 hours" and "400 days" as "last year".
const relativeUnits: readonly [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", YEAR],
  ["month", MONTH],
  ["week", WEEK],
  ["day", DAY],
  ["hour", HOUR],
  ["minute", MINUTE],
  ["second", SECOND],
];

/**
 * "5 minutes ago", "in 2 days", "yesterday". `now` is a parameter so callers
 * (and tests) control the clock.
 */
export function formatRelativeTime(
  value: DateInput,
  locale: string,
  now: DateInput = Date.now(),
  options: Intl.RelativeTimeFormatOptions = { numeric: "auto" }
): string {
  const time = toTime(value);
  const reference = toTime(now);
  if (Number.isNaN(time) || Number.isNaN(reference)) {
    return "";
  }
  const diff = time - reference;
  const formatter = new Intl.RelativeTimeFormat(locale, options);
  for (const [unit, size] of relativeUnits) {
    if (Math.abs(diff) >= size || unit === "second") {
      // Round half away from zero so the past and future read the same.
      const amount = Math.sign(diff) * Math.round(Math.abs(diff) / size);
      return formatter.format(amount, unit);
    }
  }
  return "";
}

// Decimal (SI) units: they are the ones `Intl` names, and what macOS, iOS and
// most browsers show for file sizes.
const byteUnits = [
  "byte",
  "kilobyte",
  "megabyte",
  "gigabyte",
  "terabyte",
  "petabyte",
] as const;

export function formatFileSize(bytes: number, locale: string): string {
  if (!Number.isFinite(bytes) || bytes < 0) {
    return "";
  }
  const exponent = Math.min(
    bytes < 1 ? 0 : Math.floor(Math.log10(bytes) / 3),
    byteUnits.length - 1
  );
  const value = bytes / 1000 ** exponent;
  return new Intl.NumberFormat(locale, {
    maximumFractionDigits: exponent === 0 ? 0 : 1,
    style: "unit",
    unit: byteUnits[exponent],
    // "999 bytes" reads better than CLDR's short "999 byte"; larger units are
    // conventionally abbreviated.
    unitDisplay: exponent === 0 ? "long" : "short",
  }).format(value);
}
