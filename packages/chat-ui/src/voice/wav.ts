// Microphone samples to a WAV upload (172). The browser hands us 32-bit
// float frames at the device rate; Whisper wants 16 kHz mono, so we
// downsample and write 16-bit PCM: about 32 KB a second, and every speech
// server reads it. Pure.

export const TARGET_RATE = 16_000;

/** RMS of a frame, 0 to 1. */
export const rms = (samples: Float32Array): number => {
  if (samples.length === 0) {
    return 0;
  }
  let sum = 0;
  for (const sample of samples) {
    sum += sample * sample;
  }
  return Math.sqrt(sum / samples.length);
};

/** Averages each output sample's window (a cheap low-pass), for any ratio. */
export const downsample = (
  samples: Float32Array,
  fromRate: number,
  toRate: number = TARGET_RATE
): Float32Array => {
  if (fromRate <= toRate) {
    return samples;
  }
  const ratio = fromRate / toRate;
  const length = Math.floor(samples.length / ratio);
  const out = new Float32Array(length);
  for (let index = 0; index < length; index += 1) {
    const start = Math.floor(index * ratio);
    const end = Math.min(samples.length, Math.floor((index + 1) * ratio));
    let sum = 0;
    for (let at = start; at < end; at += 1) {
      sum += samples[at] ?? 0;
    }
    out[index] = sum / Math.max(1, end - start);
  }
  return out;
};

export const concatFrames = (frames: readonly Float32Array[]): Float32Array => {
  const total = frames.reduce((sum, frame) => sum + frame.length, 0);
  const out = new Float32Array(total);
  let offset = 0;
  for (const frame of frames) {
    out.set(frame, offset);
    offset += frame.length;
  }
  return out;
};

/** 16-bit PCM mono WAV. */
export const encodeWav = (
  samples: Float32Array,
  rate: number
): Uint8Array<ArrayBuffer> => {
  const bytes = new Uint8Array(44 + samples.length * 2);
  const view = new DataView(bytes.buffer);
  const text = (offset: number, value: string) => {
    for (let index = 0; index < value.length; index += 1) {
      view.setUint8(offset + index, value.charCodeAt(index));
    }
  };
  text(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  text(8, "WAVE");
  text(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, "data");
  view.setUint32(40, samples.length * 2, true);
  samples.forEach((sample, index) => {
    const clamped = Math.max(-1, Math.min(1, sample));
    view.setInt16(
      44 + index * 2,
      clamped < 0 ? clamped * 0x80_00 : clamped * 0x7f_ff,
      true
    );
  });
  return bytes;
};

/**
 * Keeps the last `limit` samples' worth of frames, so an utterance includes
 * the moment before the detector was sure it was speech. Pure: returns the
 * new list.
 */
export const keepRecent = (
  frames: readonly Float32Array[],
  frame: Float32Array,
  limit: number
): readonly Float32Array[] => {
  const next = [...frames, frame];
  let total = next.reduce((sum, each) => sum + each.length, 0);
  let drop = 0;
  while (drop < next.length - 1 && total - (next[drop]?.length ?? 0) >= limit) {
    total -= next[drop]?.length ?? 0;
    drop += 1;
  }
  return next.slice(drop);
};
