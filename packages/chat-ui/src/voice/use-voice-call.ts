"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { type CallEvent, type CallState, callStep, INITIAL_CALL } from "./turn";
import {
  openVoiceEngine,
  type TurnTimings,
  type VoiceBridge,
  type VoiceEngine,
} from "./voice-engine";

// A voice call as React state (172). The reducer decides, the engine does;
// this hook wires them together and to the chat's `VoiceBridge`, so the
// transcript is sent as a normal message and the reply is the chat's own.

export type { TurnTimings, VoiceBridge } from "./voice-engine";

export interface VoiceTranscript {
  readonly reply: string;
  readonly user: string | null;
}

export interface UseVoiceCallOptions {
  /** Where `/api/voice/*` is; the page's origin by default. */
  readonly baseUrl?: string;
  readonly bridge: VoiceBridge;
  readonly fetch?: typeof fetch;
  /** Called once the call has ended (hang-up or a microphone failure). */
  readonly onEnded?: () => void;
}

export interface VoiceCall {
  readonly end: () => void;
  /** The audio level (0 to 1): the user's while listening, the reply's while speaking. */
  readonly level: () => number;
  readonly setMuted: (muted: boolean) => void;
  readonly start: () => Promise<void>;
  readonly state: CallState;
  /** Text heard on-device (a desktop app's speech to text): sent without an upload. */
  readonly submitText: (text: string) => void;
  readonly timings: TurnTimings | null;
  readonly transcript: VoiceTranscript;
}

const EMPTY_TRANSCRIPT: VoiceTranscript = { reply: "", user: null };

export const useVoiceCall = ({
  baseUrl = "",
  bridge,
  fetch: doFetch,
  onEnded,
}: UseVoiceCallOptions): VoiceCall => {
  const [state, setState] = useState<CallState>(INITIAL_CALL);
  const [transcript, setTranscript] = useState(EMPTY_TRANSCRIPT);
  const [timings, setTimings] = useState<TurnTimings | null>(null);
  const stateRef = useRef(state);
  const engineRef = useRef<VoiceEngine | null>(null);
  // Biome types a ref by its initial value; the getter says what it holds.
  const engine = useCallback((): VoiceEngine | null => engineRef.current, []);
  const latest = useRef({ baseUrl, bridge, doFetch, onEnded });
  useEffect(() => {
    latest.current = { baseUrl, bridge, doFetch, onEnded };
  });

  const dispatch = useCallback((event: CallEvent) => {
    const step = callStep(stateRef.current, event);
    stateRef.current = step.state;
    setState(step.state);
    for (const effect of step.effects) {
      if (effect.type === "send") {
        setTranscript({ reply: "", user: effect.text });
      }
      engineRef.current?.perform(effect);
      if (effect.type === "hang-up") {
        engineRef.current = null;
        latest.current.onEnded?.();
      }
    }
  }, []);

  const start = useCallback(async () => {
    if (engine()) {
      return;
    }
    stateRef.current = INITIAL_CALL;
    setState(INITIAL_CALL);
    setTranscript(EMPTY_TRANSCRIPT);
    try {
      engineRef.current = await openVoiceEngine(
        {
          bridge: () => latest.current.bridge,
          dispatch,
          onReplyText: (reply) =>
            setTranscript((before) => ({ ...before, reply })),
          onTimings: setTimings,
          state: () => stateRef.current,
        },
        {
          baseUrl: latest.current.baseUrl,
          fetch: latest.current.doFetch ?? globalThis.fetch.bind(globalThis),
        }
      );
      dispatch({ type: "ready" });
    } catch {
      dispatch({ error: "microphone", type: "failed" });
      latest.current.onEnded?.();
    }
  }, [dispatch, engine]);

  const end = useCallback(() => dispatch({ type: "end" }), [dispatch]);
  const setMuted = useCallback(
    (muted: boolean) => {
      engineRef.current?.setMuted(muted);
      dispatch({ muted, type: "mute" });
    },
    [dispatch]
  );
  const submitText = useCallback(
    (text: string) => dispatch({ text, type: "heard-text" }),
    [dispatch]
  );
  const level = useCallback(() => engineRef.current?.level() ?? 0, []);

  // Leaving the page ends the call.
  useEffect(
    () => () => {
      engineRef.current?.close();
      engineRef.current = null;
    },
    []
  );
  return {
    end,
    level,
    setMuted,
    start,
    state,
    submitText,
    timings,
    transcript,
  };
};
