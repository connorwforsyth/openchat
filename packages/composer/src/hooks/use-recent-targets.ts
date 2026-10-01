import { useCallback, useEffect, useState } from "react";
import { z } from "zod";

import { RECENT_LIMIT, rememberRecent } from "../options";

// The picker's "Recently used" (099): the last few targets this person
// picked, in local storage under their scope (the host passes the user id).
// Storage that's missing, full or blocked (private windows, tests, SSR)
// leaves the list in memory for the session instead; it never throws.

const storedSchema = z.array(z.string().min(1)).max(RECENT_LIMIT * 4);

const storageKeyFor = (scope: string | undefined) =>
  `composer:recent-targets:${scope ?? "anyone"}`;

const read = (key: string): readonly string[] => {
  try {
    const raw = globalThis.localStorage?.getItem(key);
    const parsed = storedSchema.safeParse(raw ? JSON.parse(raw) : []);
    return parsed.success ? parsed.data.slice(0, RECENT_LIMIT) : [];
  } catch {
    return [];
  }
};

const write = (key: string, keys: readonly string[]): void => {
  try {
    globalThis.localStorage?.setItem(key, JSON.stringify(keys));
  } catch {
    // Kept in memory only; the next pick tries again.
  }
};

/** The remembered target keys, newest first, and a way to add one. */
export const useRecentTargets = (
  scope: string | undefined
): readonly [readonly string[], (key: string) => void] => {
  const storageKey = storageKeyFor(scope);
  const [keys, setKeys] = useState<readonly string[]>([]);
  // Read after mounting: the server render has no storage, and the first
  // client render must match it.
  useEffect(() => {
    setKeys(read(storageKey));
  }, [storageKey]);
  const remember = useCallback(
    (key: string) => {
      const next = rememberRecent(keys, key);
      setKeys(next);
      write(storageKey, next);
    },
    [keys, storageKey]
  );
  return [keys, remember] as const;
};
