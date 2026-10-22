"use client";

import { createContext, useContext } from "react";

import type { VoiceBridge } from "./voice-engine";

// The open chat as a voice call sees it (172), for a call button that lives
// outside the header (a Dot's bar, in the chat's `banner`). `null` before the
// chat exists.

export const VoiceBridgeContext = createContext<VoiceBridge | null>(null);

export const useChatVoiceBridge = (): VoiceBridge | null =>
  useContext(VoiceBridgeContext);
