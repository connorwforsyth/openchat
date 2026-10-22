import type { ConversationId } from "@workspace/contract/schemas/common";
import type { ChatMode } from "@workspace/contract/schemas/runs";
import { useCallback, useEffect, useMemo, useState } from "react";

// The composer's Chat / Code switch. A chat's mode is the conversation's,
// saved as it's switched; a new chat's waits in this hook until the first
// message creates the conversation with it. The switch shows the choice at
// once, before the save comes back.

interface Chosen {
  readonly conversationId: ConversationId | null;
  readonly mode: ChatMode;
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
  save: (input: { id: ConversationId; mode: ChatMode }) => void
) => {
  const [chosen, setChosen] = useState<Chosen | null>(null);
  // New chats start in Chat.
  useEffect(() => {
    if (conversationId === null) {
      setChosen(null);
    }
  }, [conversationId]);
  const onChange = useCallback(
    (next: ChatMode) => {
      setChosen({ conversationId, mode: next });
      if (conversationId) {
        save({ id: conversationId, mode: next });
      }
    },
    [conversationId, save]
  );
  const mode = shownChatMode(conversationId, stored, chosen);
  return useMemo(() => ({ mode, onChange }), [mode, onChange]);
};
