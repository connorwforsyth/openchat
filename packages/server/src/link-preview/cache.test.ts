import { describe, expect, it } from "vitest";

import { createLruCache } from "./cache";

describe("createLruCache", () => {
  it("expires entries on their own clocks", () => {
    let now = 0;
    const cache = createLruCache<string>({ maxSize: 10, now: () => now });
    cache.set("ok", "preview", 24 * 60 * 60 * 1000);
    cache.set("failed", "none", 60 * 60 * 1000);
    now = 60 * 60 * 1000 - 1;
    expect(cache.get("failed")).toBe("none");
    now = 60 * 60 * 1000;
    expect(cache.get("failed")).toBeUndefined();
    expect(cache.get("ok")).toBe("preview");
    now = 24 * 60 * 60 * 1000;
    expect(cache.get("ok")).toBeUndefined();
  });

  it("evicts the least recently used past its size budget", () => {
    const cache = createLruCache<Uint8Array>({
      maxSize: 10,
      sizeOf: (bytes) => bytes.byteLength,
    });
    cache.set("a", new Uint8Array(4), 1000);
    cache.set("b", new Uint8Array(4), 1000);
    cache.get("a");
    cache.set("c", new Uint8Array(4), 1000);
    expect(cache.get("a")).toBeDefined();
    expect(cache.get("b")).toBeUndefined();
    expect(cache.get("c")).toBeDefined();
    // Bigger than the whole budget: not cached at all.
    cache.set("huge", new Uint8Array(11), 1000);
    expect(cache.get("huge")).toBeUndefined();
    expect(cache.get("c")).toBeDefined();
  });
});
