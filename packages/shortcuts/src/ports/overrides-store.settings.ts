import { err, ok } from "@workspace/shared/result";

import { parseOverrides, type ShortcutOverrides } from "../overrides";
import type { OverridesStore } from "./overrides-store";

// The user-settings adapter (Q31): overrides live in `UserSettings.shortcuts`
// (`GET/PATCH /me/settings`), so they follow the user to every device.
//
// Browser storage stays as the fallback, holding only what the server
// doesn't have yet: overrides recorded before 042, or a save made while the
// server couldn't answer. The next load that reaches the server moves them
// up and clears them. Keeping nothing else locally means a reset on another
// device isn't undone by a stale copy here.

/** The two calls this adapter needs; the app binds them to `me.settings` and `me.updateSettings`. */
export interface ShortcutSettingsApi {
  /** The stored `shortcuts` setting, unparsed. Rejects when the server can't answer. */
  readonly load: () => Promise<unknown>;
  /** Replaces the setting; resolves to what's now stored. Rejects on failure. */
  readonly save: (overrides: ShortcutOverrides) => Promise<unknown>;
}

const isEmpty = (overrides: ShortcutOverrides): boolean =>
  Object.keys(overrides).length === 0;

const unavailable = (cause: unknown) =>
  err({
    message: cause instanceof Error ? cause.message : "settings unavailable",
    type: "unavailable" as const,
  });

export const createSettingsOverridesStore = (
  api: ShortcutSettingsApi,
  fallback: OverridesStore
): OverridesStore => {
  /** Saves to the server and, once it has them, forgets the local copy. */
  const saveRemote = async (
    overrides: ShortcutOverrides
  ): Promise<ShortcutOverrides> => {
    const saved = parseOverrides(await api.save(overrides));
    await fallback.save({});
    return saved;
  };

  return {
    load: async () => {
      const local = await fallback.load();
      const pending = local.ok ? local.value : {};
      if (!isEmpty(pending)) {
        // Newer than the server's copy: legacy or unsaved.
        try {
          return ok(await saveRemote(pending));
        } catch {
          return ok(pending);
        }
      }
      try {
        return ok(parseOverrides(await api.load()));
      } catch {
        // Offline or signed out mid-flight: defaults, rather than a guess.
        return ok({});
      }
    },
    save: async (overrides) => {
      try {
        return ok(await saveRemote(overrides));
      } catch (cause) {
        // Kept on this device; the next load that reaches the server sends it.
        const local = await fallback.save(overrides);
        return local.ok ? local : unavailable(cause);
      }
    },
  };
};
