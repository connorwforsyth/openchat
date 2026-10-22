import type { AsyncResult } from "@workspace/shared/result";
import { z } from "zod";

// The speech ports (ticket 104/172, voice conversations). Two small
// functions, so a voice turn can be tested without a model server: audio in,
// text out; text in, audio out. Adapters speak the OpenAI audio API, which
// the self-hosted pair (Speaches for Whisper, Kokoro-FastAPI) also serves.

export const speechErrorSchema = z.discriminatedUnion("type", [
  /** The service couldn't be reached, or answered 5xx. */
  z.object({ message: z.string(), type: z.literal("unavailable") }),
  /** The service refused the input (4xx): bad audio, unknown voice. */
  z.object({ message: z.string(), type: z.literal("rejected") }),
]);
export type SpeechError = z.infer<typeof speechErrorSchema>;

export const transcriptSchema = z.object({ text: z.string() });
export type Transcript = z.infer<typeof transcriptSchema>;

export interface TranscribeInput {
  readonly audio: Blob;
  /** BCP 47, when the caller knows it; the service detects it otherwise. */
  readonly language?: string;
  readonly signal?: AbortSignal;
}

export interface SpeechToText {
  readonly transcribe: (
    input: TranscribeInput
  ) => AsyncResult<Transcript, SpeechError>;
}

export interface SpeakInput {
  readonly signal?: AbortSignal;
  readonly text: string;
  /** Overrides the configured voice. */
  readonly voice?: string;
}

export interface SpokenAudio {
  readonly body: ReadableStream<Uint8Array>;
  readonly contentType: string;
}

export interface TextToSpeech {
  readonly speak: (input: SpeakInput) => AsyncResult<SpokenAudio, SpeechError>;
}
