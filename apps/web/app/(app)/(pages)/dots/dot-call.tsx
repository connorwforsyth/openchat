"use client";

import { useChatVoiceBridge } from "@workspace/chat-ui/voice/voice-bridge";
import { VoiceCallButton } from "@workspace/chat-ui/voice/voice-call";
import { useMemo } from "react";

import { DOT_HALO, DotAvatar } from "./dot-avatar";
import type { DotSurfaceProps } from "./dot-extensions";

// Calling a Dot (172), from its bar: the voice overlay with the Dot's own
// face in the orb, which the call's level and state move. Nothing shows
// before the chat exists or when the server has no voice.

export function DotCallButton({ dot }: DotSurfaceProps) {
  const bridge = useChatVoiceBridge();
  const { avatar } = dot;
  const orb = useMemo(
    () => ({
      face: <DotAvatar avatar={avatar} className="size-32" />,
      haloClassName: DOT_HALO[avatar.color],
    }),
    [avatar]
  );
  if (!bridge) {
    return null;
  }
  return <VoiceCallButton bridge={bridge} name={dot.name} orb={orb} />;
}
