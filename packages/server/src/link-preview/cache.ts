// The link-preview caches (101): in memory, behind a small port so a
// Postgres-backed one can replace it without touching callers. In memory
// because previews are cheap to refetch, and a cache shared across
// processes isn't worth a migration yet: each process holds at most
// `maxEntries` previews and `maxBytes` of images, least recently used first
// out, and every entry expires on its own clock (24 h for a preview, 1 h for
// a failure).

export interface TtlCache<V> {
  readonly get: (key: string) => V | undefined;
  readonly set: (key: string, value: V, ttlMs: number) => void;
}

interface Entry<V> {
  readonly expiresAt: number;
  readonly size: number;
  readonly value: V;
}

export interface LruOptions<V> {
  /** Total size budget; with `sizeOf`, the image cache's byte cap. */
  readonly maxSize: number;
  readonly now?: () => number;
  /** Each entry's size; 1 by default, so `maxSize` counts entries. */
  readonly sizeOf?: (value: V) => number;
}

export const createLruCache = <V>({
  maxSize,
  now = Date.now,
  sizeOf = () => 1,
}: LruOptions<V>): TtlCache<V> => {
  // A Map iterates in insertion order: re-inserting on read keeps the least
  // recently used entry first.
  const entries = new Map<string, Entry<V>>();
  let total = 0;
  const remove = (key: string) => {
    const entry = entries.get(key);
    if (entry) {
      total -= entry.size;
      entries.delete(key);
    }
  };
  return {
    get: (key) => {
      const entry = entries.get(key);
      if (!entry) {
        return;
      }
      remove(key);
      if (entry.expiresAt <= now()) {
        return;
      }
      entries.set(key, entry);
      total += entry.size;
      return entry.value;
    },
    set: (key, value, ttlMs) => {
      remove(key);
      const size = sizeOf(value);
      if (size > maxSize) {
        return;
      }
      entries.set(key, { expiresAt: now() + ttlMs, size, value });
      total += size;
      for (const oldest of entries.keys()) {
        if (total <= maxSize) {
          break;
        }
        remove(oldest);
      }
    },
  };
};
