import { describe, expect, it } from "vitest";

import { createRateLimiter } from "./rate-limit";

describe("createRateLimiter", () => {
  it("allows `limit` requests per window per key", () => {
    let now = 0;
    const limit = createRateLimiter({
      limit: 2,
      now: () => now,
      windowMs: 60_000,
    });
    expect(limit("ada").ok).toBe(true);
    expect(limit("ada").ok).toBe(true);
    expect(limit("ada")).toEqual({ ok: false, retryAfterSeconds: 60 });
    expect(limit("grace").ok).toBe(true);
    now = 30_000;
    expect(limit("ada")).toEqual({ ok: false, retryAfterSeconds: 30 });
    now = 60_000;
    expect(limit("ada").ok).toBe(true);
  });
});
