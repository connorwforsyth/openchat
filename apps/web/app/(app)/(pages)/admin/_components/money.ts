import type { DisplayCurrency } from "@workspace/config/currency";
import { formatNumber } from "@workspace/i18n/format";

// Money is integer micro-USD on the wire (1 USD = 1_000_000), never a float.
// Only display converts, at the instance's fixed rate (`usage.currency`).

export const MICROS_PER_USD = 1_000_000;

export const formatMicros = (
  micros: number,
  locale: string,
  currency: DisplayCurrency
): string => {
  const amount = (micros / MICROS_PER_USD) * currency.perUsd;
  return formatNumber(amount, locale, {
    currency: currency.code,
    maximumFractionDigits: amount > 0 && amount < 0.01 ? 4 : 2,
    style: "currency",
  });
};

const AMOUNT = /^\d+(?:\.\d{0,6})?$/;

/**
 * A typed amount in the display currency ("12.50") to micro-USD, or `null`
 * if it isn't one.
 */
export const amountToMicros = (
  input: string,
  currency: DisplayCurrency
): number | null => {
  const trimmed = input.trim().replace(",", ".");
  if (!AMOUNT.test(trimmed)) {
    return null;
  }
  const [whole = "0", fraction = ""] = trimmed.split(".");
  const units =
    Number(whole) * MICROS_PER_USD + Number(fraction.padEnd(6, "0"));
  const micros = Math.round(units / currency.perUsd);
  return Number.isSafeInteger(units) && Number.isSafeInteger(micros)
    ? micros
    : null;
};
