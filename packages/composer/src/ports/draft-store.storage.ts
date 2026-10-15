import { err, ok } from "@workspace/shared/result";

import { type DraftStore, parseDraft } from "./draft-store";

// The browser-storage adapter: one `localStorage` entry per draft, so two
// tabs on different chats never overwrite each other, and on the same chat
// the last write wins. Storage is asked for on each call (not held) so the
// adapter can be made during server rendering, where there is none, and
// storage that's blocked or full only costs the draft.

export type StorageLike = Pick<Storage, "getItem" | "removeItem" | "setItem">;

const unavailable = (cause: unknown) =>
  err({
    message: cause instanceof Error ? cause.message : "storage unavailable",
    type: "unavailable" as const,
  });

/** Browser storage, or `null` on the server and where it's blocked. */
export const browserStorage = (): StorageLike | null => {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    // Reading `localStorage` throws where the browser blocks site data.
    return null;
  }
};

/**
 * Drafts under `composer:draft:<scope>:<key>`. `scope` is whose drafts they
 * are, like the signed-in user's id, so people sharing a browser don't see
 * each other's.
 */
export const createStorageDraftStore = (
  storage: () => StorageLike | null,
  scope: string
): DraftStore => {
  const entry = (key: string) => `composer:draft:${scope}:${key}`;
  return {
    clear: (key) => {
      try {
        storage()?.removeItem(entry(key));
        return ok(undefined);
      } catch (cause) {
        return unavailable(cause);
      }
    },
    load: (key) => {
      const store = storage();
      if (!store) {
        return ok(null);
      }
      try {
        const raw = store.getItem(entry(key));
        return ok(raw ? parseDraft(JSON.parse(raw)) : null);
      } catch {
        // Corrupt JSON is as good as no draft.
        return ok(null);
      }
    },
    save: (key, draft) => {
      const store = storage();
      if (!store) {
        return unavailable(null);
      }
      try {
        store.setItem(entry(key), JSON.stringify(draft));
        return ok(undefined);
      } catch (cause) {
        return unavailable(cause);
      }
    },
  };
};
