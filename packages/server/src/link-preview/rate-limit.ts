// Per-user request limits for link previews (101): a fixed window per key,
// in memory. Each preview can make the server fetch up to four pages and
// each image one more, so a user can't turn the fetcher into a crawler.

export type RateLimiter = (
  key: string
) =>
  | { readonly ok: true }
  | { readonly ok: false; readonly retryAfterSeconds: number };

export const createRateLimiter = ({
  limit,
  now = Date.now,
  windowMs,
}: {
  readonly limit: number;
  readonly now?: () => number;
  readonly windowMs: number;
}): RateLimiter => {
  const windows = new Map<string, { count: number; resetsAt: number }>();
  return (key) => {
    const at = now();
    if (windows.size > 10_000) {
      for (const [stale, window] of windows) {
        if (window.resetsAt <= at) {
          windows.delete(stale);
        }
      }
    }
    const current = windows.get(key);
    if (!current || current.resetsAt <= at) {
      windows.set(key, { count: 1, resetsAt: at + windowMs });
      return { ok: true };
    }
    if (current.count >= limit) {
      return {
        ok: false,
        retryAfterSeconds: Math.ceil((current.resetsAt - at) / 1000),
      };
    }
    current.count += 1;
    return { ok: true };
  };
};
