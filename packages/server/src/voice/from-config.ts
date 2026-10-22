import type { AppConfig } from "@workspace/config/schema";
import { z } from "zod";

import type { SpeechToText, TextToSpeech } from "../ports/speech";
import {
  createOpenAiRealtimeSessions,
  createOpenAiSpeechToText,
  createOpenAiTextToSpeech,
  type RealtimeSessions,
} from "./openai-compatible";

// `voice:` in app.config.yaml to the speech ports. No URLs (local) or no key
// (openai) means no voice at all: the routes answer 404 and the client
// hides the call button. Pure apart from building the adapters.

export const voiceInfoSchema = z.object({
  enabled: z.boolean(),
  maxUploadMb: z.number(),
  provider: z.enum(["local", "openai"]).nullable(),
  /** Speech-to-speech is available (OpenAI Realtime). */
  realtime: z.boolean(),
});
export type VoiceInfo = z.infer<typeof voiceInfoSchema>;

export interface Voice {
  readonly info: VoiceInfo;
  readonly realtime: RealtimeSessions | null;
  readonly stt: SpeechToText;
  readonly tts: TextToSpeech;
}

export const VOICE_OFF: VoiceInfo = {
  enabled: false,
  maxUploadMb: 0,
  provider: null,
  realtime: false,
};

export const createVoice = (
  config: AppConfig,
  options: { readonly fetch?: typeof fetch } = {}
): Voice | null => {
  const { voice } = config;
  if (voice.provider === "openai") {
    const apiKey = voice.openai.apiKey ?? config.providers.openai?.apiKey;
    if (!apiKey) {
      return null;
    }
    const base = {
      apiKey,
      baseUrl: voice.openai.baseURL,
      fetch: options.fetch,
    };
    return {
      info: {
        enabled: true,
        maxUploadMb: voice.maxUploadMb,
        provider: "openai",
        realtime: true,
      },
      realtime: createOpenAiRealtimeSessions({
        ...base,
        model: voice.openai.realtimeModel,
        voice: voice.openai.voice,
      }),
      stt: createOpenAiSpeechToText({ ...base, model: voice.openai.sttModel }),
      tts: createOpenAiTextToSpeech({
        ...base,
        model: voice.openai.ttsModel,
        voice: voice.openai.voice,
      }),
    };
  }
  if (!(voice.stt.url && voice.tts.url)) {
    return null;
  }
  return {
    info: {
      enabled: true,
      maxUploadMb: voice.maxUploadMb,
      provider: "local",
      realtime: false,
    },
    realtime: null,
    stt: createOpenAiSpeechToText({
      baseUrl: voice.stt.url,
      fetch: options.fetch,
      model: voice.stt.model,
    }),
    tts: createOpenAiTextToSpeech({
      baseUrl: voice.tts.url,
      fetch: options.fetch,
      model: voice.tts.model,
      voice: voice.tts.voice,
    }),
  };
};
