import { err, ok } from "@workspace/shared/result";

import { parseOverrides } from "../overrides";
import type { OverridesStore } from "./overrides-store";

// The browser-storage adapter: one JSON entry per user. `Storage` is passed
// in (not read from `window`) so the adapter runs in tests and never touches
// storage during server rendering.

export type StorageLike = Pick<Storage, "getItem" | "setItem">;

const unavailable = (cause: unknown) =>
  err({
    message: cause instanceof Error ? cause.message : "storage unavailable",
    type: "unavailable" as const,
  });

export const createStorageOverridesStore = (
  storage: StorageLike | null,
  key: string
): OverridesStore => ({
  load: () => {
    if (!storage) {
      return Promise.resolve(ok({}));
    }
    try {
      const raw = storage.getItem(key);
      return Promise.resolve(ok(raw ? parseOverrides(JSON.parse(raw)) : {}));
    } catch {
      // Corrupt JSON is as good as nothing saved: fall back to defaults.
      return Promise.resolve(ok({}));
    }
  },
  save: (overrides) => {
    if (!storage) {
      return Promise.resolve(unavailable(null));
    }
    try {
      storage.setItem(key, JSON.stringify(overrides));
      return Promise.resolve(ok(overrides));
    } catch (cause) {
      return Promise.resolve(unavailable(cause));
    }
  },
});
