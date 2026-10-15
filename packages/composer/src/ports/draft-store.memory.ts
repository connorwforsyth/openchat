import { ok } from "@workspace/shared/result";

import type { Draft, DraftKey, DraftStore } from "./draft-store";

// An in-memory DraftStore for tests and for hosts that shouldn't keep drafts
// past the page. Records every write for assertions.

export type DraftWrite =
  | { readonly draft: Draft; readonly key: DraftKey; readonly type: "save" }
  | { readonly key: DraftKey; readonly type: "clear" };

export interface MemoryDraftStore extends DraftStore {
  readonly writes: readonly DraftWrite[];
}

export const createMemoryDraftStore = (
  initial: Readonly<Record<DraftKey, Draft>> = {}
): MemoryDraftStore => {
  const drafts = new Map<DraftKey, Draft>(Object.entries(initial));
  const writes: DraftWrite[] = [];
  return {
    clear: (key) => {
      drafts.delete(key);
      writes.push({ key, type: "clear" });
      return ok(undefined);
    },
    load: (key) => ok(drafts.get(key) ?? null),
    save: (key, draft) => {
      drafts.set(key, draft);
      writes.push({ draft, key, type: "save" });
      return ok(undefined);
    },
    writes,
  };
};
