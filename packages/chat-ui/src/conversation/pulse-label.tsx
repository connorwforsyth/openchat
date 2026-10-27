import type { ReactNode } from "react";

/**
 * A status that's still going, like "Thinking…". It pulses in opacity rather
 * than shimmering: D28 animates only transform and opacity, and a moving
 * background gradient is neither.
 */
export function PulseLabel({ children }: { readonly children: ReactNode }) {
  return <span className="motion-safe:animate-status-pulse">{children}</span>;
}
