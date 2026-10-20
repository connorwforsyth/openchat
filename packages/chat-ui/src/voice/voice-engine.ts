import type { ReplyEvent, VoiceReplies } from "./reply";
import {
  BARGE_IN_VAD,
  type CallEffect,
  type CallEvent,
  type CallState,
  DEFAULT_VAD,
  INITIAL_VAD,
  type VadState,
  vadStep,
} from "./turn";
import {
  concatFrames,
  downsample,
  encodeWav,
  keepRecent,
  rms,
  TARGET_RATE,
} from "./wav";

// The voice call's imperative shell (172): the microphone, the uploads and
// the player. What happens next is decided by `callStep` and `vadStep`
// (pure, in turn.ts); this carries out their effects and feeds them events.

/**
 * The chat as the call sees it. `ConnectedChat` builds it: a turn is sent
 * through the chat (so it shows there) and its reply comes back as
 * sentences and an explicit end (`reply.ts`).
 */
export interface VoiceBridge {
  readonly replies: VoiceReplies;
}

/** Milliseconds per stage of the last turn. */
export interface TurnTimings {
  /** First sentence of text to its audio playing (TTS plus decode). */
  readonly firstAudioMs: number | null;
  /** Transcript sent to the reply's first text (run start plus model). */
  readonly firstTextMs: number | null;
  /** End of speech to transcript (upload plus STT). */
  readonly transcribeMs: number | null;
}

export interface EngineHooks {
  readonly bridge: () => VoiceBridge;
  readonly dispatch: (event: CallEvent) => void;
  readonly onReplyText: (text: string) => void;
  readonly onTimings: (timings: TurnTimings) => void;
  readonly state: () => CallState;
}

export interface EngineOptions {
  readonly baseUrl: string;
  readonly fetch: typeof fetch;
}

export interface VoiceEngine {
  readonly close: () => void;
  readonly level: () => number;
  readonly perform: (effect: CallEffect) => void;
  readonly setMuted: (muted: boolean) => void;
}

/** Utterances are cut at this length, whatever the detector thinks. */
const MAX_UTTERANCE_S = 30;
/** Audio kept from before speech was detected. */
const PREROLL_S = 0.4;
/** The detector sees the mic in frames of this length. */
const FRAME_S = 0.02;

const TAP_WORKLET = `
class VoiceTap extends AudioWorkletProcessor {
  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (channel) this.port.postMessage(channel.slice(0));
    return true;
  }
}
registerProcessor("voice-tap", VoiceTap);
`;

interface Turn {
  firstAudio: number | null;
  firstText: number | null;
  speechEnd: number | null;
  transcribed: number | null;
}

const newTurn = (): Turn => ({
  firstAudio: null,
  firstText: null,
  speechEnd: null,
  transcribed: null,
});

const span = (from: number | null, to: number | null) =>
  from === null || to === null ? null : Math.round(to - from);

/** The stages of a finished turn. Pure. */
export const timingsOf = (turn: Turn): TurnTimings => ({
  firstAudioMs: span(turn.firstText, turn.firstAudio),
  firstTextMs: span(turn.transcribed, turn.firstText),
  transcribeMs: span(turn.speechEnd, turn.transcribed),
});

const isTalking = (phase: CallState["phase"]) =>
  phase === "speaking" ||
  phase === "paused" ||
  phase === "thinking" ||
  phase === "transcribing";

interface Queued {
  readonly audio: Promise<AudioBuffer | null>;
  readonly controller: AbortController;
}

export const openVoiceEngine = async (
  hooks: EngineHooks,
  options: EngineOptions
): Promise<VoiceEngine> => {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      autoGainControl: true,
      channelCount: 1,
      echoCancellation: true,
      noiseSuppression: true,
    },
  });
  const context = new AudioContext();
  const url = URL.createObjectURL(
    new Blob([TAP_WORKLET], { type: "text/javascript" })
  );
  try {
    await context.audioWorklet.addModule(url);
  } finally {
    URL.revokeObjectURL(url);
  }
  const tap = new AudioWorkletNode(context, "voice-tap");
  context.createMediaStreamSource(stream).connect(tap);
  const output = context.createAnalyser();
  output.fftSize = 1024;
  output.connect(context.destination);
  const outBuffer = new Float32Array(output.fftSize);
  const rate = context.sampleRate;
  const api = (path: string) => `${options.baseUrl}/api/voice/${path}`;

  // Mutable call state: this closure is the shell.
  let batch: Float32Array[] = [];
  let batchLength = 0;
  let preroll: readonly Float32Array[] = [];
  let utterance: Float32Array[] | null = null;
  let utteranceLength = 0;
  let vad: VadState = INITIAL_VAD;
  let micLevel = 0;
  let generation = 0;
  let queue: Queued[] = [];
  let playing: AudioBufferSourceNode | null = null;
  let looping = false;
  let transcribing: AbortController | null = null;
  /** The utterance being transcribed, kept in case the user goes on. */
  let heard: readonly Float32Array[] = [];
  let turn = newTurn();
  /** The reply being listened to; aborting it cancels its run. */
  let replying: AbortController | null = null;

  const playOne = (buffer: AudioBuffer) =>
    new Promise<void>((resolve) => {
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.connect(output);
      source.onended = () => resolve();
      playing = source;
      source.start();
      turn.firstAudio ??= performance.now();
      hooks.dispatch({ type: "audio-started" });
    });

  // Plays the queue in order; each sentence's audio was fetched when it was
  // queued, so the next is usually ready when the last ends.
  const drain = async () => {
    if (looping) {
      return;
    }
    looping = true;
    const mine = generation;
    try {
      let head = queue.at(0);
      while (head && generation === mine) {
        // biome-ignore lint/performance/noAwaitInLoops: sentences play one after another.
        const buffer = await head.audio;
        if (generation !== mine) {
          return;
        }
        queue.shift();
        if (buffer) {
          await playOne(buffer);
          playing = null;
        }
        head = queue.at(0);
      }
    } finally {
      looping = false;
    }
    if (generation === mine) {
      if (turn.firstAudio !== null) {
        hooks.onTimings(timingsOf(turn));
      }
      hooks.dispatch({ type: "audio-idle" });
    }
  };

  // One synthesis at a time: on a CPU speech server, parallel requests share
  // the cores and the first sentence (the one that matters) comes later.
  let synthesis: Promise<unknown> = Promise.resolve();

  const speak = (sentence: string) => {
    const controller = new AbortController();
    const audio = synthesis
      .then(() =>
        options.fetch(api("speak"), {
          body: JSON.stringify({ text: sentence }),
          credentials: "same-origin",
          headers: { "content-type": "application/json" },
          method: "POST",
          signal: controller.signal,
        })
      )
      .then((response) => {
        if (!response.ok) {
          throw new Error(`speak ${response.status}`);
        }
        return response.arrayBuffer();
      })
      .then((bytes) => context.decodeAudioData(bytes))
      .catch(() => {
        if (!controller.signal.aborted) {
          hooks.dispatch({ error: "speech", type: "failed" });
        }
        return null;
      });
    synthesis = audio;
    queue.push({ audio, controller });
    drain().catch(() => undefined);
  };

  const stopSpeaking = () => {
    generation += 1;
    for (const item of queue) {
      item.controller.abort();
    }
    queue = [];
    playing?.stop();
    playing = null;
    transcribing?.abort();
    transcribing = null;
    heard = [];
  };

  const upload = async (wav: Uint8Array<ArrayBuffer>, signal: AbortSignal) => {
    const response = await options.fetch(api("transcribe"), {
      body: new Blob([wav], { type: "audio/wav" }),
      credentials: "same-origin",
      headers: { "content-type": "audio/wav" },
      method: "POST",
      signal,
    });
    if (!response.ok) {
      throw Object.assign(new Error(`transcribe ${response.status}`), {
        status: response.status,
      });
    }
    const body = (await response.json()) as { text?: unknown };
    return typeof body.text === "string" ? body.text : "";
  };

  const transcribe = async () => {
    const frames = utterance;
    utterance = null;
    if (!frames) {
      return;
    }
    heard = frames;
    turn = { ...newTurn(), speechEnd: performance.now() };
    const samples = downsample(concatFrames(frames), rate);
    const wav = encodeWav(samples, Math.min(TARGET_RATE, rate));
    const controller = new AbortController();
    transcribing = controller;
    try {
      const text = await upload(wav, controller.signal);
      turn.transcribed = performance.now();
      hooks.dispatch({ text, type: "transcribed" });
    } catch (cause) {
      if (!controller.signal.aborted) {
        const down =
          typeof cause === "object" &&
          cause !== null &&
          "status" in cause &&
          cause.status === 503;
        hooks.dispatch({
          error: down ? "unavailable" : "transcription",
          type: "failed",
        });
      }
    } finally {
      if (transcribing === controller) {
        transcribing = null;
        heard = [];
      }
    }
  };

  const stopReply = () => {
    replying?.abort();
    replying = null;
  };

  const onReply = (event: ReplyEvent, controller: AbortController) => {
    // A barge-in or hang-up cancelled it: the reducer has moved on.
    if (controller.signal.aborted) {
      return;
    }
    switch (event.type) {
      case "text":
        turn.firstText ??= performance.now();
        hooks.onReplyText(event.text);
        return;
      case "sentence":
        speak(event.sentence);
        return;
      case "end": {
        if (replying === controller) {
          replying = null;
        }
        const pending = queue.length > 0 || playing !== null;
        hooks.dispatch(
          event.end === "failed" && turn.firstText === null
            ? { error: "reply", type: "failed" }
            : { pending, type: "reply-finished" }
        );
        return;
      }
      default: {
        const unreachable: never = event;
        return unreachable;
      }
    }
  };

  // Each turn's reply, sentence by sentence, until it says it's over.
  const listen = async (text: string) => {
    stopReply();
    const controller = new AbortController();
    replying = controller;
    for await (const event of hooks
      .bridge()
      .replies.ask(text, controller.signal)) {
      onReply(event, controller);
    }
  };

  const close = () => {
    stopReply();
    stopSpeaking();
    tap.port.onmessage = null;
    for (const track of stream.getTracks()) {
      track.stop();
    }
    context.close().catch(() => undefined);
  };

  const perform = (effect: CallEffect) => {
    switch (effect.type) {
      case "start-recording":
        utterance = [...preroll];
        utteranceLength = preroll.reduce((sum, frame) => sum + frame.length, 0);
        return;
      case "resume-recording":
        transcribing?.abort();
        transcribing = null;
        utterance = [...heard, ...preroll];
        utteranceLength = utterance.reduce(
          (sum, frame) => sum + frame.length,
          0
        );
        heard = [];
        return;
      case "discard-recording":
        utterance = null;
        return;
      case "transcribe":
        transcribe().catch(() => undefined);
        return;
      case "send":
        turn = {
          ...turn,
          transcribed: turn.transcribed ?? performance.now(),
        };
        listen(effect.text).catch(() => undefined);
        return;
      case "interrupt":
        stopSpeaking();
        stopReply();
        return;
      case "hang-up":
        close();
        return;
      default: {
        const unreachable: never = effect;
        return unreachable;
      }
    }
  };

  const detect = () => {
    const { muted, phase } = hooks.state();
    if (muted || phase === "connecting" || phase === "ended") {
      return;
    }
    const step = vadStep(
      vad,
      micLevel,
      performance.now(),
      isTalking(phase) ? BARGE_IN_VAD : DEFAULT_VAD
    );
    vad = step.state;
    const tooLong =
      utterance !== null && utteranceLength > rate * MAX_UTTERANCE_S;
    if (step.event === "speech-start") {
      hooks.dispatch({ type: "speech-start" });
    } else if (step.event === "speech-end" || tooLong) {
      vad = { ...vad, speaking: false };
      hooks.dispatch({ type: "speech-end" });
    }
  };

  tap.port.onmessage = (message: MessageEvent<Float32Array>) => {
    batch.push(message.data);
    batchLength += message.data.length;
    if (batchLength < rate * FRAME_S) {
      return;
    }
    const frame = concatFrames(batch);
    batch = [];
    batchLength = 0;
    micLevel = rms(frame);
    preroll = keepRecent(preroll, frame, rate * PREROLL_S);
    if (utterance) {
      utterance.push(frame);
      utteranceLength += frame.length;
    }
    detect();
  };

  return {
    close,
    level: () => {
      if (hooks.state().phase !== "speaking") {
        return micLevel;
      }
      output.getFloatTimeDomainData(outBuffer);
      return rms(outBuffer);
    },
    perform,
    setMuted: (muted) => {
      for (const track of stream.getAudioTracks()) {
        track.enabled = !muted;
      }
    },
  };
};
