"use client";

import { Trans, useLingui } from "@lingui/react/macro";

import { useCurrency } from "@/app/(app)/_shared/currency";

import { formatMicros } from "./money";

/**
 * A usage cost. Tokens at no cost mean no price was known for the model
 * (a local one, say), so it reads "Unpriced" rather than a misleading $0.
 */
export const Cost = ({
  micros,
  tokens,
}: {
  readonly micros: number;
  readonly tokens: number;
}) => {
  const { i18n } = useLingui();
  const currency = useCurrency();
  if (micros === 0 && tokens > 0) {
    return (
      <span className="text-muted-foreground">
        <Trans>Unpriced</Trans>
      </span>
    );
  }
  return formatMicros(micros, i18n.locale, currency);
};

/** Where the numbers come from, under every table of costs. */
export const PricesNote = () => {
  const { i18n } = useLingui();
  const { code, perUsd } = useCurrency();
  const rate = i18n.number(perUsd, { maximumFractionDigits: 6 });
  return (
    <p className="text-muted-foreground text-xs">
      <Trans>
        Costs are estimates at{" "}
        <a
          className="underline underline-offset-2 hover:text-foreground"
          href="https://models.dev"
          rel="noopener noreferrer"
          target="_blank"
        >
          models.dev
        </a>{" "}
        list prices unless this instance sets its own. Unpriced models aren't
        counted.
      </Trans>{" "}
      {code === "USD" ? null : (
        <Trans>
          Shown in {code}, converted from US dollars at a fixed {rate} per
          dollar.
        </Trans>
      )}
    </p>
  );
};
