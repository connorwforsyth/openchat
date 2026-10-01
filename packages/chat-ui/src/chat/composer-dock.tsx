"use client";

import {
  ComposerLoader,
  type ComposerLoaderProps,
} from "@workspace/composer/components/composer-loader";
import type { ComposerValue } from "@workspace/composer/schemas";
import type { ConversationId } from "@workspace/contract/schemas/common";
import { cn } from "@workspace/ui/lib/utils";
import { type Ref, useCallback, useState } from "react";

import { EmptyGreeting, EmptySuggestions } from "../conversation/empty-state";

// Where the composer sits (098): in the middle of a new chat, with the
// greeting over it and suggestions under it, then at the bottom from the
// first send on, as ChatGPT and Claude do.

export type ComposerPlacement = "center" | "bottom";

/**
 * A chat with an address has started, so a reload of one renders the
 * composer at the bottom on the server already, before its messages load.
 * Pure.
 */
export const composerPlacement = ({
  conversationId,
  messageCount,
  sent,
}: {
  readonly conversationId: ConversationId | null;
  readonly messageCount: number;
  /** A new chat's first message was sent and its chat is being made. */
  readonly sent: boolean;
}): ComposerPlacement =>
  conversationId === null && messageCount === 0 && !sent ? "center" : "bottom";

/**
 * The placement, plus the submit and new-chat handlers that move it: a
 * first send moves the composer down at once, before the chat it creates has
 * an address (creating it and uploading files take a moment), and a new
 * chat brings it back to the middle.
 */
export const useComposerPlacement = ({
  conversationId,
  messageCount,
  onNewChat,
  onSubmit,
}: {
  readonly conversationId: ConversationId | null;
  readonly messageCount: number;
  readonly onNewChat: () => void;
  readonly onSubmit: (value: ComposerValue) => void;
}) => {
  const [sent, setSent] = useState(false);
  const [sentIn, setSentIn] = useState(conversationId);
  if (sentIn !== conversationId) {
    setSentIn(conversationId);
    setSent(false);
  }
  const isNewChat = conversationId === null;
  const submit = useCallback(
    (value: ComposerValue) => {
      if (isNewChat) {
        setSent(true);
      }
      onSubmit(value);
    },
    [isNewChat, onSubmit]
  );
  const newChat = useCallback(() => {
    setSent(false);
    onNewChat();
  }, [onNewChat]);
  return {
    newChat,
    placement: composerPlacement({ conversationId, messageCount, sent }),
    submit,
  };
};

export interface ComposerDockProps {
  readonly composer: ComposerLoaderProps;
  /** Sends a suggestion; none are offered without it. */
  readonly onSuggestion?: (prompt: string) => void;
  readonly placement: ComposerPlacement;
  readonly ref?: Ref<HTMLDivElement>;
}

/**
 * The composer under the conversation. It's always this one element in the
 * flow at the bottom of the column, so it keeps focus (and its draft) when it
 * moves; centred, it's moved up from there by `translate`, against the
 * column's height (a size container, `cqh`), so the server renders it in
 * place without measuring anything.
 */
export function ComposerDock({
  composer,
  onSuggestion,
  placement,
  ref,
}: ComposerDockProps) {
  const centered = placement === "center";
  return (
    <div
      className={cn(
        "relative mx-auto w-full max-w-2xl shrink-0 px-6 pb-[max(--spacing(4),env(safe-area-inset-bottom))]",
        // Its own half height up from the bottom, less the column's: centred
        // a little above the middle (45% down; 40% on a phone, whose keyboard
        // takes the lower part). Only transform moves (D28): the move down
        // slides, the way back (a new chat) jumps, and reduced motion jumps.
        centered
          ? "translate-y-[calc(50%-55cqh)] max-md:translate-y-[calc(50%-60cqh)]"
          : "transition-transform duration-(--motion-base) ease-motion-in-out motion-reduce:transition-none"
      )}
      data-placement={placement}
      data-slot="composer-dock"
      ref={ref}
    >
      {centered ? (
        <div className="absolute inset-x-6 bottom-full pb-6">
          <EmptyGreeting />
        </div>
      ) : null}
      <ComposerLoader {...composer} />
      {centered && onSuggestion ? (
        <div className="absolute inset-x-6 top-full">
          <EmptySuggestions onSuggestion={onSuggestion} />
        </div>
      ) : null}
    </div>
  );
}
