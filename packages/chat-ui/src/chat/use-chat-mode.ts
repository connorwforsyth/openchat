import type { ConversationId } from "@workspace/contract/schemas/common";
import type { ChatMode } from "@workspace/contract/schemas/runs";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

// The composer's Chat / Code switch. A chat's mode is the conversation's,
// saved as it's switched; a new chat's waits in this hook until the first
// message creates the conversation with it. The switch shows the choice at
// once, before the save comes back.

interface Chosen {
  readonly conversationId: ConversationId | null;
  readonly mode: ChatMode;
  readonly storedAt?: number;
}

/** The mode the switch shows. Pure. */
export const shownChatMode = (
  conversationId: ConversationId | null,
  stored: ChatMode | undefined,
  chosen: Chosen | null
): ChatMode => {
  if (chosen?.conversationId === conversationId) {
    return chosen.mode;
  }
  // A chat created a moment ago keeps the choice until its own loads.
  return stored ?? (chosen?.conversationId === null ? chosen.mode : "chat");
};

export const useChatMode = (
  conversationId: ConversationId | null,
  stored: ChatMode | undefined,
  save: (input: { id: ConversationId; mode: ChatMode }) => Promise<unknown>,
  storedAt?: number
) => {
  const [chosen, setChosen] = useState<Chosen | null>(null);
  const choice = useRef(chosen);
  const [savedChoice, setSavedChoice] = useState<Chosen | null>(null);
  const [failedId, setFailedId] = useState<ConversationId | null>(null);
  const pending = useRef({ conversationId, promise: Promise.resolve(true) });
  const source = useRef({ conversationId, stored, storedAt });
  useLayoutEffect(() => {
    source.current = { conversationId, stored, storedAt };
    if (
      savedChoice === choice.current &&
      savedChoice?.conversationId === conversationId &&
      (stored === savedChoice.mode || storedAt !== savedChoice.storedAt)
    ) {
      choice.current = null;
      setChosen(null);
      setSavedChoice(null);
    }
  }, [conversationId, savedChoice, stored, storedAt]);
  useEffect(() => {
    if (conversationId === null) {
      choice.current = null;
      setChosen(null);
    }
  }, [conversationId]);
  const onChange = useCallback(
    (next: ChatMode) => {
      const selected = {
        conversationId,
        mode: next,
        storedAt: source.current.storedAt,
      };
      choice.current = selected;
      setChosen(selected);
      setSavedChoice(null);
      setFailedId(null);
      if (conversationId) {
        // Serial writes prevent an older save from landing after a newer choice.
        const promise = pending.current.promise.then(async () => {
          let saved = false;
          try {
            await save({ id: conversationId, mode: next });
            saved = true;
          } catch {
            saved = false;
          }
          if (choice.current === selected) {
            if (saved) {
              setSavedChoice(selected);
            } else {
              choice.current = null;
              setChosen(null);
              setFailedId(conversationId);
            }
          }
          return saved;
        });
        pending.current = { conversationId, promise };
      }
    },
    [conversationId, save]
  );
  const flush = useCallback(async () => {
    const id = source.current.conversationId;
    let saving = pending.current;
    while (saving.conversationId === id) {
      // biome-ignore lint/performance/noAwaitInLoops: a newer choice may arrive while this save waits.
      const saved = await saving.promise;
      if (saving === pending.current || pending.current.conversationId !== id) {
        return saved;
      }
      saving = pending.current;
    }
    return true;
  }, []);
  const current = useCallback(
    () =>
      shownChatMode(
        source.current.conversationId,
        source.current.stored,
        choice.current
      ),
    []
  );
  const mode = shownChatMode(conversationId, stored, chosen);
  const failed = conversationId !== null && failedId === conversationId;
  return useMemo(
    () => ({ current, failed, flush, mode, onChange }),
    [current, failed, flush, mode, onChange]
  );
};
