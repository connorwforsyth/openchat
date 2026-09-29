"use client";

import { Trans } from "@lingui/react/macro";

/**
 * "Thinking…" while a reply has nothing to show yet. It pulses in opacity
 * rather than shimmering: D28 animates only transform and opacity, and a
 * moving background gradient is neither.
 */
export function ThinkingLabel() {
  return (
    <span className="motion-safe:animate-pulse">
      <Trans>Thinking…</Trans>
    </span>
  );
}
