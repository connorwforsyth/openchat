import { err, ok } from "@workspace/shared/result";

import type { SpeechError, SpeechToText, TextToSpeech } from "./speech";

// In-memory speech for tests: the transcript is whatever the test says the
// audio "said", and speaking returns the text's bytes as fake audio.

export interface MemorySpeechToText extends SpeechToText {
  /** Every audio blob transcribed, in order. */
  readonly heard: readonly Blob[];
}

export const createMemorySpeechToText = (
  answer: (audio: Blob) => string | SpeechError
): MemorySpeechToText => {
  const heard: Blob[] = [];
  return {
    heard,
    transcribe: ({ audio }) => {
      heard.push(audio);
      const text = answer(audio);
      return Promise.resolve(
        typeof text === "string" ? ok({ text }) : err(text)
      );
    },
  };
};

export interface MemoryTextToSpeech extends TextToSpeech {
  /** Every text spoken, in order. */
  readonly spoken: readonly string[];
}

export const FAKE_AUDIO_TYPE = "audio/x-fake";

export const createMemoryTextToSpeech = (
  fail?: SpeechError
): MemoryTextToSpeech => {
  const spoken: string[] = [];
  return {
    speak: ({ text }) => {
      if (fail) {
        return Promise.resolve(err(fail));
      }
      spoken.push(text);
      return Promise.resolve(
        ok({
          body: new Blob([text]).stream(),
          contentType: FAKE_AUDIO_TYPE,
        })
      );
    },
    spoken,
  };
};
