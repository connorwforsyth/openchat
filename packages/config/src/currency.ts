import { z } from "zod";

// How costs are shown. Money is stored and summed in integer micro-USD
// everywhere; an instance that reports in another currency names it and a
// fixed rate here, and only the display converts. No exchange rate is
// fetched: the operator sets it and updates it when they choose.

const CURRENCY_CODE = /^[A-Z]{3}$/;

export const displayCurrencySchema = z
  .strictObject({
    /** An ISO 4217 code, like `AUD`. */
    code: z
      .string()
      .regex(CURRENCY_CODE, "an ISO 4217 code, like `AUD`")
      .refine(
        (code) => Intl.supportedValuesOf("currency").includes(code),
        "a currency this runtime can format"
      ),
    /**
     * Units of `code` per US dollar: `1.52` shows $1.00 as A$1.52. Capped so
     * a converted cost stays a safe integer of the currency's millionths.
     */
    perUsd: z.number().positive().max(1_000_000),
  })
  .refine(
    (currency) => currency.code !== "USD" || currency.perUsd === 1,
    "USD is 1 per USD"
  )
  .readonly();
export type DisplayCurrency = z.infer<typeof displayCurrencySchema>;

export const USD: DisplayCurrency = Object.freeze({ code: "USD", perUsd: 1 });

export const usageSchema = z
  .strictObject({ currency: displayCurrencySchema.default(USD) })
  .prefault({});
