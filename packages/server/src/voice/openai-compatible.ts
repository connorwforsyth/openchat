import type { AsyncResult } from "@workspace/shared/result";
import { err, ok } from "@workspace/shared/result";
import { z } from "zod";

import type { SpeechError, SpeechToText, TextToSpeech } from "../ports/speech";
import { transcriptSchema } from "../ports/speech";

// The speech ports over the OpenAI audio API (`/audio/transcriptions`,
// `/audio/speech`). The same adapter serves the self-hosted pair (Speaches
// for Whisper, Kokoro-FastAPI), which implement that API, and OpenAI itself
// with a key. `baseUrl` ends in `/v1`.

export interface OpenAiCompatibleOptions {
  readonly apiKey?: string;
  readonly baseUrl: string;
  readonly fetch?: typeof fetch;
}

const TRAILING_SLASHES = /\/+$/;

const endpoint = (baseUrl: string, path: string) =>
  `${baseUrl.replace(TRAILING_SLASHES, "")}${path}`;

const authHeaders = (apiKey: string | undefined): Record<string, string> =>
  apiKey ? { authorization: `Bearer ${apiKey}` } : {};

/** What a non-2xx answer means for the caller. Pure. */
export const speechErrorOf = (status: number, detail: string): SpeechError =>
  status >= 400 && status < 500
    ? { message: `${status}: ${detail}`.slice(0, 500), type: "rejected" }
    : { message: `${status}: ${detail}`.slice(0, 500), type: "unavailable" };

const call = async (
  doFetch: typeof fetch,
  url: string,
  init: RequestInit
): AsyncResult<Response, SpeechError> => {
  try {
    const response = await doFetch(url, init);
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      return err(speechErrorOf(response.status, detail));
    }
    return ok(response);
  } catch (cause) {
    if (init.signal?.aborted) {
      throw cause;
    }
    return err({
      message: cause instanceof Error ? cause.message : "fetch failed",
      type: "unavailable",
    });
  }
};

/** File names the service uses to guess the container. */
const EXTENSIONS: Readonly<Record<string, string>> = {
  "audio/mp4": "m4a",
  "audio/mpeg": "mp3",
  "audio/ogg": "ogg",
  "audio/wav": "wav",
  "audio/webm": "webm",
  "audio/x-wav": "wav",
};

export const audioFileName = (type: string) =>
  `utterance.${EXTENSIONS[type.split(";")[0]?.trim() ?? ""] ?? "webm"}`;

export const createOpenAiSpeechToText = (
  options: OpenAiCompatibleOptions & { readonly model: string }
): SpeechToText => ({
  transcribe: async ({ audio, language, signal }) => {
    const form = new FormData();
    form.set("file", audio, audioFileName(audio.type));
    form.set("model", options.model);
    form.set("response_format", "json");
    if (language) {
      form.set("language", language);
    }
    const response = await call(
      options.fetch ?? fetch,
      endpoint(options.baseUrl, "/audio/transcriptions"),
      {
        body: form,
        headers: authHeaders(options.apiKey),
        method: "POST",
        signal,
      }
    );
    if (!response.ok) {
      return response;
    }
    const parsed = transcriptSchema.safeParse(
      await response.value.json().catch(() => null)
    );
    return parsed.success
      ? ok({ text: parsed.data.text.trim() })
      : err({ message: "unexpected transcription body", type: "unavailable" });
  },
});

export const createOpenAiTextToSpeech = (
  options: OpenAiCompatibleOptions & {
    readonly model: string;
    readonly voice: string;
  }
): TextToSpeech => ({
  speak: async ({ signal, text, voice }) => {
    const response = await call(
      options.fetch ?? fetch,
      endpoint(options.baseUrl, "/audio/speech"),
      {
        body: JSON.stringify({
          input: text,
          model: options.model,
          response_format: "mp3",
          voice: voice ?? options.voice,
        }),
        headers: {
          ...authHeaders(options.apiKey),
          "content-type": "application/json",
        },
        method: "POST",
        signal,
      }
    );
    if (!response.ok) {
      return response;
    }
    const { body } = response.value;
    return body
      ? ok({
          body,
          contentType:
            response.value.headers.get("content-type") ?? "audio/mpeg",
        })
      : err({ message: "empty speech body", type: "unavailable" });
  },
});

// OpenAI Realtime (speech to speech over WebRTC): the server mints a
// short-lived client secret, so the browser never sees the API key.

export const realtimeSecretSchema = z.object({
  expires_at: z.number(),
  value: z.string().min(1),
});

export interface RealtimeSessionInput {
  readonly instructions?: string;
  readonly signal?: AbortSignal;
  readonly tools?: readonly {
    readonly description: string;
    readonly name: string;
    readonly parameters: unknown;
  }[];
}

export interface RealtimeSecret {
  readonly expiresAt: number;
  readonly model: string;
  readonly secret: string;
}

/** The seam a Realtime provider plugs into; only OpenAI has one today. */
export interface RealtimeSessions {
  readonly mint: (
    input: RealtimeSessionInput
  ) => AsyncResult<RealtimeSecret, SpeechError>;
}

export const createOpenAiRealtimeSessions = (
  options: OpenAiCompatibleOptions & {
    readonly model: string;
    readonly voice: string;
  }
): RealtimeSessions => ({
  mint: async ({ instructions, signal, tools }) => {
    const response = await call(
      options.fetch ?? fetch,
      endpoint(options.baseUrl, "/realtime/client_secrets"),
      {
        body: JSON.stringify({
          expires_after: { anchor: "created_at", seconds: 60 },
          session: {
            audio: { output: { voice: options.voice } },
            model: options.model,
            type: "realtime",
            ...(instructions ? { instructions } : {}),
            ...(tools?.length
              ? { tools: tools.map((tool) => ({ ...tool, type: "function" })) }
              : {}),
          },
        }),
        headers: {
          ...authHeaders(options.apiKey),
          "content-type": "application/json",
        },
        method: "POST",
        signal,
      }
    );
    if (!response.ok) {
      return response;
    }
    const parsed = realtimeSecretSchema.safeParse(
      await response.value.json().catch(() => null)
    );
    return parsed.success
      ? ok({
          expiresAt: parsed.data.expires_at,
          model: options.model,
          secret: parsed.data.value,
        })
      : err({ message: "unexpected client secret body", type: "unavailable" });
  },
});
