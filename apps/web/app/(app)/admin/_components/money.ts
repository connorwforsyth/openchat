import { formatNumber } from "@workspace/i18n/format";

// Money is integer micro-USD on the wire (1 USD = 1_000_000), never a float.

export const MICROS_PER_USD = 1_000_000;

export const formatMicros = (micros: number, locale: string): string =>
  formatNumber(micros / MICROS_PER_USD, locale, {
    currency: "USD",
    maximumFractionDigits: micros > 0 && micros < 10_000 ? 4 : 2,
    style: "currency",
  });

const AMOUNT = /^\d+(?:\.\d{0,6})?$/;

/** A typed dollar amount ("12.50") to micros, or `null` if it isn't one. */
export const usdToMicros = (input: string): number | null => {
  const trimmed = input.trim().replace(",", ".");
  if (!AMOUNT.test(trimmed)) {
    return null;
  }
  const [whole = "0", fraction = ""] = trimmed.split(".");
  const micros =
    Number(whole) * MICROS_PER_USD + Number(fraction.padEnd(6, "0"));
  return Number.isSafeInteger(micros) ? micros : null;
};
