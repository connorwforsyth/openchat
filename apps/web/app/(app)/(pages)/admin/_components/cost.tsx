"use client";

import { Trans, useLingui } from "@lingui/react/macro";

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
  if (micros === 0 && tokens > 0) {
    return (
      <span className="text-muted-foreground">
        <Trans>Unpriced</Trans>
      </span>
    );
  }
  return formatMicros(micros, i18n.locale);
};

/** Where the numbers come from, under every table of costs. */
export const PricesNote = () => (
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
    </Trans>
  </p>
);
