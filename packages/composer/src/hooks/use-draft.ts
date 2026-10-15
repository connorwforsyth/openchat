import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
} from "react";

import { createDraftSaver } from "../drafts";
import {
  type Draft,
  type DraftKey,
  NEW_CHAT_DRAFT_KEY,
} from "../ports/draft-store";
import type { ComposerDraftOptions } from "../props";

// Keeps the composer's draft in a DraftStore under the host's key (147): it
// restores the key's draft when the composer mounts and whenever the key
// changes (switching chats), and saves as the person types. The composer
// stays mounted across chats (the dock moves it, 098), so a key change swaps
// the draft rather than remounting.

interface UseDraftOptions {
  readonly draft: ComposerDraftOptions | undefined;
  /** The draft as it stands: the editor's document and the composer's state. */
  readonly read: () => Draft;
  /** Puts a saved draft in place, or empties the composer for `null`. */
  readonly restore: (draft: Draft | null) => void;
  /**
   * Something was typed in the shell before the editor loaded; on mount it
   * wins over a saved draft.
   */
  readonly typedFirst: boolean;
}

export interface DraftControls {
  /** The draft changed; saved once typing pauses. */
  readonly changed: () => void;
  /** The draft was sent: forget it. */
  readonly sent: () => void;
}

export const useDraft = ({
  draft,
  read,
  restore,
  typedFirst,
}: UseDraftOptions): DraftControls => {
  const store = draft?.store;
  const key = draft?.key;
  const saver = useMemo(
    () => (store ? createDraftSaver(store) : null),
    [store]
  );

  const latest = useRef({ read, restore });
  useLayoutEffect(() => {
    latest.current = { read, restore };
  });
  const keyRef = useRef(key);
  const mounted = useRef(false);
  const typedFirstRef = useRef(typedFirst);
  // A new chat's first send makes its chat, then the host moves to it. What
  // is typed in between belongs to that chat, not to the next new one.
  const lastSent = useRef<DraftKey | null>(null);

  useEffect(() => {
    if (saver === null || key === undefined) {
      return;
    }
    const previous = keyRef.current;
    keyRef.current = key;
    const first = !mounted.current;
    mounted.current = true;
    if (previous === NEW_CHAT_DRAFT_KEY && lastSent.current === previous) {
      lastSent.current = null;
      saver.discard(NEW_CHAT_DRAFT_KEY);
      saver.load(key);
      saver.schedule(key, () => latest.current.read());
    } else if (!(first && typedFirstRef.current)) {
      latest.current.restore(saver.load(key));
    }
    // `pagehide` rather than `beforeunload`: it also fires when the page
    // goes into the back-forward cache and on mobile tab discards, and
    // listening to it doesn't block that cache.
    const flush = () => saver.flush();
    globalThis.addEventListener("pagehide", flush);
    return () => {
      globalThis.removeEventListener("pagehide", flush);
      // The editor still holds this key's draft: write it before the next
      // key's replaces it.
      saver.flush();
    };
  }, [key, saver]);

  const changed = useCallback(() => {
    const { current } = keyRef;
    if (saver !== null && current !== undefined && mounted.current) {
      saver.schedule(current, () => latest.current.read());
    }
  }, [saver]);

  const sent = useCallback(() => {
    const { current } = keyRef;
    if (saver === null || current === undefined) {
      return;
    }
    lastSent.current = current;
    saver.discard(current);
  }, [saver]);

  return { changed, sent };
};
