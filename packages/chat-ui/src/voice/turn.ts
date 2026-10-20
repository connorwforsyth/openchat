// The voice call's turn-taking (172), as a pure reducer and a pure
// energy-based voice activity detector. The hook in `use-voice-call.ts`
// feeds them microphone levels and service answers, and carries out the
// effects they return; everything that decides *what happens next* is here.

// ---------------------------------------------------------------------------
// Voice activity detection: an adaptive noise floor and two timers.

export interface VadOptions {
  /** Silence this long ends an utterance. */
  readonly endMs: number;
  /** Below this a level is never speech, however quiet the room. */
  readonly minLevel: number;
  /** Speech is this many times the noise floor. */
  readonly ratio: number;
  /** Level must stay up this long to count (a click or a cough doesn't). */
  readonly startMs: number;
}

export const DEFAULT_VAD: VadOptions = {
  endMs: 800,
  minLevel: 0.02,
  ratio: 3,
  startMs: 150,
};

/** While the assistant talks, its own voice leaks into the mic: ask for more. */
export const BARGE_IN_VAD: VadOptions = {
  ...DEFAULT_VAD,
  minLevel: 0.06,
  ratio: 5,
  startMs: 250,
};

export interface VadState {
  readonly aboveSince: number | null;
  readonly belowSince: number | null;
  /** The room's level, learnt while nobody speaks. */
  readonly noise: number;
  readonly speaking: boolean;
}

export const INITIAL_VAD: VadState = {
  aboveSince: null,
  belowSince: null,
  noise: 0.005,
  speaking: false,
};

export type VadEvent = "speech-start" | "speech-end" | null;

/** One frame: `level` is the mic's RMS (0 to 1) at `now` ms. Pure. */
export const vadStep = (
  state: VadState,
  level: number,
  now: number,
  options: VadOptions = DEFAULT_VAD
): { readonly event: VadEvent; readonly state: VadState } => {
  const threshold = Math.max(options.minLevel, state.noise * options.ratio);
  const loud = level >= threshold;
  if (!state.speaking) {
    if (!loud) {
      return {
        event: null,
        state: {
          ...state,
          aboveSince: null,
          // Learn the room slowly, only from quiet frames.
          noise: state.noise * 0.95 + level * 0.05,
        },
      };
    }
    const aboveSince = state.aboveSince ?? now;
    return now - aboveSince >= options.startMs
      ? {
          event: "speech-start",
          state: {
            ...state,
            aboveSince: null,
            belowSince: null,
            speaking: true,
          },
        }
      : { event: null, state: { ...state, aboveSince } };
  }
  if (loud) {
    return { event: null, state: { ...state, belowSince: null } };
  }
  const belowSince = state.belowSince ?? now;
  return now - belowSince >= options.endMs
    ? {
        event: "speech-end",
        state: {
          ...state,
          aboveSince: null,
          belowSince: null,
          speaking: false,
        },
      }
    : { event: null, state: { ...state, belowSince } };
};

// ---------------------------------------------------------------------------
// The call.

export type CallPhase =
  | "connecting"
  /** Waiting for the user. */
  | "listening"
  /** The user is talking. */
  | "hearing"
  | "transcribing"
  /** Waiting for the reply's first sentence (or the next one). */
  | "thinking"
  | "speaking"
  | "ended";

/** What the orb shows. */
export type OrbState = "idle" | "listening" | "thinking" | "speaking";

export const orbStateOf = (phase: CallPhase): OrbState => {
  switch (phase) {
    case "connecting":
    case "ended":
      return "idle";
    case "listening":
    case "hearing":
      return "listening";
    case "transcribing":
    case "thinking":
      return "thinking";
    case "speaking":
      return "speaking";
    default: {
      const unreachable: never = phase;
      return unreachable;
    }
  }
};

export interface CallState {
  /** The last problem, shown until the next turn. */
  readonly error: CallError | null;
  readonly muted: boolean;
  readonly phase: CallPhase;
  /** The reply's run has ended; once the audio queue drains, it's the user's turn. */
  readonly replyDone: boolean;
}

export type CallError =
  | "microphone"
  | "transcription"
  /** The server's speech service is down (503), not the user's audio. */
  | "unavailable"
  | "speech"
  | "reply";

export const INITIAL_CALL: CallState = {
  error: null,
  muted: false,
  phase: "connecting",
  replyDone: true,
};

export type CallEvent =
  | { readonly type: "ready" }
  | { readonly type: "speech-start" }
  | { readonly type: "speech-end" }
  | { readonly text: string; readonly type: "transcribed" }
  /**
   * Text that's already transcribed (a desktop app's on-device speech to
   * text): skips the upload and sends straight away.
   */
  | { readonly text: string; readonly type: "heard-text" }
  | { readonly type: "audio-started" }
  /** The playback queue is empty. */
  | { readonly type: "audio-idle" }
  /** `pending`: sentences are still being spoken or fetched. */
  | { readonly pending: boolean; readonly type: "reply-finished" }
  | { readonly type: "mute"; readonly muted: boolean }
  | { readonly error: CallError; readonly type: "failed" }
  | { readonly type: "end" };

export type CallEffect =
  | { readonly type: "start-recording" }
  /** Stop recording and upload the utterance for transcription. */
  | { readonly type: "transcribe" }
  | { readonly type: "discard-recording" }
  | { readonly text: string; readonly type: "send" }
  /** Stop speaking and cancel the reply's run (barge-in, hang-up). */
  | { readonly type: "interrupt" }
  | { readonly type: "hang-up" };

export interface CallStep {
  readonly effects: readonly CallEffect[];
  readonly state: CallState;
}

const stay = (state: CallState): CallStep => ({ effects: [], state });

const busy = (phase: CallPhase) =>
  phase === "transcribing" || phase === "thinking" || phase === "speaking";

const send = (state: CallState, text: string): CallStep => {
  const trimmed = text.trim();
  return trimmed
    ? {
        effects: [{ text: trimmed, type: "send" }],
        state: { ...state, error: null, phase: "thinking", replyDone: false },
      }
    : // Nothing was said (a cough, a door): back to listening, quietly.
      { effects: [], state: { ...state, phase: "listening" } };
};

type Handler<T extends CallEvent["type"]> = (
  state: CallState,
  event: Extract<CallEvent, { readonly type: T }>
) => CallStep;

const onSpeechStart: Handler<"speech-start"> = (state) => {
  // Room noise or speaker echo while the reply is still being worked out
  // would cancel it before a word is spoken, so only audible speech can be
  // talked over.
  if (
    state.muted ||
    state.phase === "connecting" ||
    state.phase === "hearing" ||
    state.phase === "transcribing" ||
    state.phase === "thinking"
  ) {
    return stay(state);
  }
  // Barge-in: talking over the reply stops it.
  return {
    effects: [
      ...(state.phase === "speaking" ? [{ type: "interrupt" } as const] : []),
      { type: "start-recording" },
    ],
    state: { ...state, error: null, phase: "hearing", replyDone: true },
  };
};

const onHeardText: Handler<"heard-text"> = (state, event) => {
  if (state.phase === "connecting") {
    return stay(state);
  }
  const sent = send(state, event.text);
  return {
    effects: [
      ...(busy(state.phase) ? [{ type: "interrupt" } as const] : []),
      ...sent.effects,
    ],
    state: sent.state,
  };
};

const onAudioIdle: Handler<"audio-idle"> = (state) =>
  state.phase === "speaking" || state.phase === "thinking"
    ? stay({ ...state, phase: state.replyDone ? "listening" : "thinking" })
    : stay(state);

// `audio-idle` follows once the last sentence has played; a reply with
// nothing (left) to say goes straight back to listening.
const onReplyFinished: Handler<"reply-finished"> = (state, event) =>
  stay({
    ...state,
    phase:
      state.phase === "thinking" && !event.pending ? "listening" : state.phase,
    replyDone: true,
  });

const onMute: Handler<"mute"> = (state, event) =>
  event.muted && state.phase === "hearing"
    ? {
        effects: [{ type: "discard-recording" }],
        state: { ...state, muted: true, phase: "listening" },
      }
    : stay({ ...state, muted: event.muted });

const onFailed: Handler<"failed"> = (state, event) => {
  if (event.error === "microphone") {
    return {
      effects: [{ type: "hang-up" }],
      state: { ...state, error: event.error, phase: "ended" },
    };
  }
  // A sentence that couldn't be spoken doesn't stop the rest.
  const phase =
    event.error === "speech" && state.phase === "speaking"
      ? "speaking"
      : "listening";
  return stay({ ...state, error: event.error, phase, replyDone: true });
};

const handlers: { readonly [T in CallEvent["type"]]: Handler<T> } = {
  "audio-idle": onAudioIdle,
  "audio-started": (state) =>
    stay(state.phase === "thinking" ? { ...state, phase: "speaking" } : state),
  end: (state) => ({
    effects: [{ type: "interrupt" }, { type: "hang-up" }],
    state: { ...state, phase: "ended" },
  }),
  failed: onFailed,
  "heard-text": onHeardText,
  mute: onMute,
  ready: (state) =>
    stay(
      state.phase === "connecting" ? { ...state, phase: "listening" } : state
    ),
  "reply-finished": onReplyFinished,
  "speech-end": (state) =>
    state.phase === "hearing"
      ? {
          effects: [{ type: "transcribe" }],
          state: { ...state, phase: "transcribing" },
        }
      : stay(state),
  "speech-start": onSpeechStart,
  transcribed: (state, event) =>
    state.phase === "transcribing" ? send(state, event.text) : stay(state),
};

/** Pure. A call that has ended ignores everything. */
export const callStep = (state: CallState, event: CallEvent): CallStep => {
  if (state.phase === "ended") {
    return stay(state);
  }
  const handler = handlers[event.type] as Handler<typeof event.type>;
  return handler(state, event as never);
};
