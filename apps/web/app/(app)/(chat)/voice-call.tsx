"use client";

import { useQuery } from "@tanstack/react-query";
import { VoiceCallButton } from "@workspace/chat-ui/voice/voice-call";
import type { VoiceBridge } from "@workspace/chat-ui/voice/voice-engine";
import type { ConversationId } from "@workspace/contract/schemas/common";

import { useApi } from "@/app/(app)/_shared/api";

// The chat header's call button (172), named for the Dot when the chat is a
// Dot's (the list is the one the Dot banner already keeps fresh). Hidden
// when the server has no voice configured.

export function ChatVoiceCall({
  bridge,
  conversationId,
}: {
  readonly bridge: VoiceBridge;
  readonly conversationId: ConversationId;
}) {
  const { query } = useApi();
  const dots = useQuery(query.dots.list.queryOptions({ input: {} }));
  const dot = dots.data?.find((each) => each.conversationId === conversationId);
  return <VoiceCallButton bridge={bridge} name={dot?.name ?? null} />;
}
