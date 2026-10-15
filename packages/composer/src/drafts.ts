import type { JSONContent } from "@tiptap/core";

import { serializeDoc } from "./doc";
import {
  type Draft,
  type DraftKey,
  type DraftNode,
  type DraftStore,
  draftNodeSchema,
} from "./ports/draft-store";

// Saving drafts as people type (147): writes wait until typing pauses, as
// T3 Code does, so a keystroke never costs a storage write. Whatever is
// pending is written at once when the page goes away (`pagehide`), when the
// composer switches chats and when it unmounts.

/** How long typing must pause before the draft is written. */
export const DRAFT_SAVE_DELAY_MS = 300;

/** Nothing worth keeping: no words, no mentions and no skills. */
export const isEmptyDraft = (draft: Draft): boolean =>
  serializeDoc(draft.doc).text === "" && draft.skills.length === 0;

/**
 * The editor's document as a draft's. It always fits; were it not to, the
 * words are kept as plain text rather than the draft lost.
 */
export const draftDoc = (doc: JSONContent): DraftNode => {
  const parsed = draftNodeSchema.safeParse(doc);
  if (parsed.success) {
    return parsed.data;
  }
  const { text } = serializeDoc(doc);
  return {
    content: [
      {
        content: text === "" ? [] : [{ text, type: "text" }],
        type: "paragraph",
      },
    ],
    type: "doc",
  };
};

export interface DraftSaver {
  /** Forgets the draft now, and anything pending for it (it was sent). */
  readonly discard: (key: DraftKey) => void;
  /** Writes whatever is pending now. */
  readonly flush: () => void;
  /** The saved draft, remembered so an unchanged one isn't written back. */
  readonly load: (key: DraftKey) => Draft | null;
  /**
   * Writes the draft once typing pauses. `read` runs then, so the draft
   * written is the latest; a pending write for another key goes first.
   */
  readonly schedule: (key: DraftKey, read: () => Draft) => void;
}

interface Pending {
  readonly key: DraftKey;
  readonly read: () => Draft;
  readonly timer: ReturnType<typeof setTimeout>;
}

/**
 * Debounced writes to `store`. Writes are best effort: storage that's full
 * or blocked loses the draft, never the composer. A draft identical to the
 * one last read or written for its key isn't written, so a tab that only
 * shows a chat never overwrites what another tab typed into it.
 */
export const createDraftSaver = (
  store: DraftStore,
  delayMs: number = DRAFT_SAVE_DELAY_MS
): DraftSaver => {
  let pending: Pending | null = null;
  // Last known stored JSON per key; `null` when nothing is stored.
  const known = new Map<DraftKey, string | null>();

  const write = (key: DraftKey, draft: Draft) => {
    const json = isEmptyDraft(draft) ? null : JSON.stringify(draft);
    if (known.has(key) && known.get(key) === json) {
      return;
    }
    known.set(key, json);
    if (json === null) {
      store.clear(key);
    } else {
      store.save(key, draft);
    }
  };

  const flush = () => {
    if (pending === null) {
      return;
    }
    const { key, read, timer } = pending;
    pending = null;
    clearTimeout(timer);
    write(key, read());
  };

  return {
    discard: (key) => {
      if (pending?.key === key) {
        clearTimeout(pending.timer);
        pending = null;
      }
      known.set(key, null);
      store.clear(key);
    },
    flush,
    load: (key) => {
      const loaded = store.load(key);
      const draft = loaded.ok ? loaded.value : null;
      known.set(key, draft ? JSON.stringify(draft) : null);
      return draft;
    },
    schedule: (key, read) => {
      if (pending !== null && pending.key !== key) {
        flush();
      }
      if (pending !== null) {
        clearTimeout(pending.timer);
      }
      pending = { key, read, timer: setTimeout(flush, delayMs) };
    },
  };
};
