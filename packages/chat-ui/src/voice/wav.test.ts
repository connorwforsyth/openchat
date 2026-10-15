import { describe, expect, it } from "vitest";

import { concatFrames, downsample, encodeWav, keepRecent, rms } from "./wav";

describe("wav", () => {
  it("writes a 16 kHz mono PCM header and samples", () => {
    const wav = encodeWav(new Float32Array([0, 1, -1]), 16_000);
    const view = new DataView(wav.buffer);
    expect(new TextDecoder().decode(wav.slice(0, 4))).toBe("RIFF");
    expect(new TextDecoder().decode(wav.slice(8, 12))).toBe("WAVE");
    expect(view.getUint32(24, true)).toBe(16_000);
    expect(view.getUint32(40, true)).toBe(6);
    expect(view.getInt16(46, true)).toBe(0x7f_ff);
    expect(view.getInt16(48, true)).toBe(-0x80_00);
    expect(wav.length).toBe(50);
  });

  it("downsamples 48 kHz to 16 kHz by averaging", () => {
    const out = downsample(
      new Float32Array([0.3, 0.3, 0.3, 0.6, 0.6, 0.6]),
      48_000
    );
    expect([...out].map((value) => value.toFixed(1))).toEqual(["0.3", "0.6"]);
    const same = new Float32Array([1]);
    expect(downsample(same, 16_000)).toBe(same);
  });

  it("measures level", () => {
    expect(rms(new Float32Array([]))).toBe(0);
    expect(rms(new Float32Array([0.5, -0.5]))).toBeCloseTo(0.5);
  });

  it("keeps a pre-roll of recent frames", () => {
    const frame = (n: number) => new Float32Array(n);
    let frames: readonly Float32Array[] = [];
    for (let index = 0; index < 10; index += 1) {
      frames = keepRecent(frames, frame(100), 300);
    }
    expect(concatFrames(frames).length).toBe(300);
  });
});
