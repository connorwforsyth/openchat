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
  const style = { currency: currency.code, style: "currency" } as const;
  // The currency's own digits (2 for USD, 0 for JPY, 3 for BHD), and two
  // more for an amount under its smallest unit, so one cheap call doesn't
  // read as nothing.
  const digits =
    new Intl.NumberFormat(locale, style).resolvedOptions()
      .maximumFractionDigits ?? 2;
  const tiny = amount > 0 && amount < 10 ** -digits;
  return formatNumber(amount, locale, {
    ...style,
    maximumFractionDigits: tiny ? digits + 2 : digits,
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
