// Not transition-all, and not transition-[height]: comments can't animate.
export const a = "transition-[transform,opacity] duration-(--motion-fast)";
export const b = "transition-colors transition-opacity transition-transform";
export const c = "[transition:transform_100ms,opacity_150ms] motion-exit";
export const d = { transition: "opacity 150ms" };
// ci-guard-ignore motion: a measured one-off, see the ticket
export const e = "transition-[height]";
