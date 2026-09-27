import { ok } from "@workspace/shared/result";

import type { ShortcutOverrides } from "../overrides";
import type { OverridesStore } from "./overrides-store";

// An in-memory OverridesStore for tests and for surfaces with no user yet.
// Records every save for assertions.

export interface MemoryOverridesStore extends OverridesStore {
  readonly saves: readonly ShortcutOverrides[];
}

export const createMemoryOverridesStore = (
  initial: ShortcutOverrides = {}
): MemoryOverridesStore => {
  let current = initial;
  const saves: ShortcutOverrides[] = [];
  return {
    load: () => Promise.resolve(ok(current)),
    save: (overrides) => {
      current = overrides;
      saves.push(overrides);
      return Promise.resolve(ok(overrides));
    },
    saves,
  };
};
