import { describe, expect, it } from "vitest";

import {
  type CallEvent,
  type CallState,
  callStep,
  DEFAULT_VAD,
  INITIAL_CALL,
  INITIAL_VAD,
  orbStateOf,
  type VadEvent,
  vadStep,
} from "./turn";

const run = (events: readonly CallEvent[], from: CallState = INITIAL_CALL) =>
  events.reduce(
    (acc, event) => {
      const step = callStep(acc.state, event);
      return {
        effects: [...acc.effects, ...step.effects.map((e) => e.type)],
        state: step.state,
      };
    },
    { effects: [] as string[], state: from }
  );

describe("callStep", () => {
  it("runs a whole turn", () => {
    const { effects, state } = run([
      { type: "ready" },
      { type: "speech-start" },
      { type: "speech-end" },
      { text: "What's next?", type: "transcribed" },
      { type: "audio-started" },
      { pending: true, type: "reply-finished" },
      { type: "audio-idle" },
    ]);
    expect(effects).toEqual(["start-recording", "transcribe", "send"]);
    expect(state.phase).toBe("listening");
  });

  it("waits for more sentences while the reply streams", () => {
    const { state } = run([
      { type: "ready" },
      { type: "speech-start" },
      { type: "speech-end" },
      { text: "Hi", type: "transcribed" },
      { type: "audio-started" },
      { type: "audio-idle" },
    ]);
    expect(state.phase).toBe("thinking");
  });

  it("goes back to listening when nothing was said", () => {
    const { effects, state } = run([
      { type: "ready" },
      { type: "speech-start" },
      { type: "speech-end" },
      { text: "  ", type: "transcribed" },
    ]);
    expect(effects).not.toContain("send");
    expect(state.phase).toBe("listening");
  });

  it("lets the user barge in on the reply", () => {
    const { effects, state } = run([
      { type: "ready" },
      { text: "Tell me a long story", type: "heard-text" },
      { type: "audio-started" },
      { type: "speech-start" },
    ]);
    expect(effects).toEqual(["send", "interrupt", "start-recording"]);
    expect(state.phase).toBe("hearing");
    expect(orbStateOf(state.phase)).toBe("listening");
  });

  it("keeps thinking when noise starts before the reply speaks", () => {
    const { effects, state } = run([
      { type: "ready" },
      { type: "speech-start" },
      { type: "speech-end" },
      { text: "What's next?", type: "transcribed" },
      { type: "speech-start" },
      { type: "speech-end" },
    ]);
    expect(effects).toEqual(["start-recording", "transcribe", "send"]);
    expect(state.phase).toBe("thinking");
  });

  it("ignores speech while muted and drops a half-heard utterance on mute", () => {
    const heard = run([{ type: "ready" }, { type: "speech-start" }]);
    const muted = run(
      [{ muted: true, type: "mute" }, { type: "speech-start" }],
      heard.state
    );
    expect(muted.effects).toEqual(["discard-recording"]);
    expect(muted.state.phase).toBe("listening");
  });

  it("accepts on-device text without uploading audio", () => {
    const { effects } = run([
      { type: "ready" },
      { text: "Run the digest now", type: "heard-text" },
    ]);
    expect(effects).toEqual(["send"]);
  });

  it("hangs up on a microphone failure, and ends for good", () => {
    const failed = run([{ error: "microphone", type: "failed" }]);
    expect(failed.effects).toEqual(["hang-up"]);
    expect(run([{ type: "ready" }], failed.state).state.phase).toBe("ended");
    const ended = run([{ type: "ready" }, { type: "end" }]);
    expect(ended.effects).toEqual(["interrupt", "hang-up"]);
  });

  it("keeps listening after a service error, and shows it", () => {
    const { state } = run([
      { type: "ready" },
      { type: "speech-start" },
      { type: "speech-end" },
      { error: "transcription", type: "failed" },
    ]);
    expect(state).toMatchObject({ error: "transcription", phase: "listening" });
  });
});

describe("vadStep", () => {
  const feed = (frames: readonly [number, number][]) => {
    let state = INITIAL_VAD;
    const events: VadEvent[] = [];
    for (const [now, level] of frames) {
      const step = vadStep(state, level, now, DEFAULT_VAD);
      ({ state } = step);
      if (step.event) {
        events.push(step.event);
      }
    }
    return events;
  };

  it("starts after sustained speech and ends after silence", () => {
    const frames: [number, number][] = [];
    for (let t = 0; t < 500; t += 20) {
      frames.push([t, 0.003]);
    }
    for (let t = 500; t < 1500; t += 20) {
      frames.push([t, 0.2]);
    }
    for (let t = 1500; t < 2500; t += 20) {
      frames.push([t, 0.003]);
    }
    expect(feed(frames)).toEqual(["speech-start", "speech-end"]);
  });

  it("ignores a click", () => {
    expect(
      feed([
        [0, 0.003],
        [20, 0.3],
        [40, 0.003],
        [60, 0.003],
      ])
    ).toEqual([]);
  });

  it("doesn't end on a short pause", () => {
    const frames: [number, number][] = [];
    for (let t = 0; t < 400; t += 20) {
      frames.push([t, 0.2]);
    }
    for (let t = 400; t < 800; t += 20) {
      frames.push([t, 0.003]);
    }
    for (let t = 800; t < 1000; t += 20) {
      frames.push([t, 0.2]);
    }
    expect(feed(frames)).toEqual(["speech-start"]);
  });
});
