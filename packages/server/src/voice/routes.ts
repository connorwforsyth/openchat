import type { Hono } from "hono";
import { z } from "zod";

import type { SessionResolver } from "../context";
import { problem } from "../http/problem";
import { VOICE_OFF, type Voice } from "./from-config";

// Voice over plain HTTP (ticket 172): the browser never talks to the speech
// services, only to these routes, which need a session. Not procedures:
// audio goes up as raw bytes and comes back as a stream, which oRPC's JSON
// contract doesn't carry (the same reason files and the run stream are plain
// routes). `GET /api/voice` tells the client whether to show the call button.
//
//   GET  /api/voice                  { enabled, provider, realtime, maxUploadMb }
//   POST /api/voice/transcribe       body: audio bytes (Content-Type: audio/*) → { text }
//   POST /api/voice/speak            { text, voice? } → audio/mpeg
//   POST /api/voice/realtime/session → { secret, expiresAt, model } (openai only)

export const VOICE_PATHS = {
  info: "/api/voice",
  realtime: "/api/voice/realtime/session",
  speak: "/api/voice/speak",
  transcribe: "/api/voice/transcribe",
} as const;

/** One sentence or so at a time; longer text is the client's bug. */
export const MAX_SPEAK_CHARS = 2000;

export const speakBodySchema = z.object({
  text: z.string().trim().min(1).max(MAX_SPEAK_CHARS),
  voice: z
    .string()
    .regex(/^[\w.+-]{1,64}$/)
    .optional(),
});

const LANGUAGE = /^[a-z]{2,3}(-[A-Za-z]{2,4})?$/;

const AUDIO_TYPE = /^audio\/[\w.+-]+(;.*)?$/;

/**
 * The one tool a Realtime session gets: hand the request to the chat's
 * agent (the Dot, with all its tools) as a normal message, and read its
 * answer back. The browser runs it through the same run path a typed
 * message takes, so approvals and history work as usual.
 */
export const REALTIME_ASK_TOOL = {
  description:
    "Ask the assistant that owns this conversation to do something or answer something. It has tools (search, files, a workspace, schedules) and the conversation's history. Use it for anything beyond small talk, then speak its answer briefly.",
  name: "ask_assistant",
  parameters: {
    additionalProperties: false,
    properties: {
      request: {
        description: "What the user asked, in full, in their words.",
        type: "string",
      },
    },
    required: ["request"],
    type: "object",
  },
} as const;

const REALTIME_INSTRUCTIONS =
  "You are the voice of a chat assistant. Keep spoken answers short and natural. For any real question or task, call ask_assistant and speak what it returns.";

export interface VoiceRouteDeps {
  readonly resolveSession: SessionResolver;
  /** `null` when voice isn't configured. */
  readonly voice: Voice | null;
}

const failure = (error: { readonly type: "rejected" | "unavailable" }) =>
  error.type === "rejected"
    ? problem(422, "UNPROCESSABLE_CONTENT", "The speech service refused that.")
    : problem(
        503,
        "SERVICE_UNAVAILABLE",
        "The speech service isn't answering. Is the `voice` compose profile running?"
      );

export const mountVoiceRoutes = (
  app: Hono,
  { resolveSession, voice }: VoiceRouteDeps
) => {
  const notConfigured = () =>
    problem(404, "NOT_FOUND", "Voice isn't configured on this server.");

  app.get(VOICE_PATHS.info, async (c) => {
    if (!(await resolveSession(c.req.raw))) {
      return problem(401, "UNAUTHORIZED", "Sign in to continue.");
    }
    return c.json(voice?.info ?? VOICE_OFF);
  });

  app.post(VOICE_PATHS.transcribe, async (c) => {
    if (!(await resolveSession(c.req.raw))) {
      return problem(401, "UNAUTHORIZED", "Sign in to continue.");
    }
    if (!voice) {
      return notConfigured();
    }
    const type = c.req.header("content-type") ?? "";
    if (!AUDIO_TYPE.test(type)) {
      return problem(415, "UNSUPPORTED_MEDIA_TYPE", "Send audio/* bytes.");
    }
    const limit = voice.info.maxUploadMb * 1024 * 1024;
    const declared = Number(c.req.header("content-length") ?? "0");
    if (declared > limit) {
      return problem(413, "PAYLOAD_TOO_LARGE", "That recording is too long.");
    }
    const bytes = await c.req.arrayBuffer();
    if (bytes.byteLength > limit) {
      return problem(413, "PAYLOAD_TOO_LARGE", "That recording is too long.");
    }
    if (bytes.byteLength === 0) {
      return problem(400, "BAD_REQUEST", "No audio.");
    }
    const language = c.req.query("language");
    const result = await voice.stt.transcribe({
      audio: new Blob([bytes], { type }),
      signal: c.req.raw.signal,
      ...(language && LANGUAGE.test(language) ? { language } : {}),
    });
    return result.ok ? c.json(result.value) : failure(result.error);
  });

  app.post(VOICE_PATHS.speak, async (c) => {
    if (!(await resolveSession(c.req.raw))) {
      return problem(401, "UNAUTHORIZED", "Sign in to continue.");
    }
    if (!voice) {
      return notConfigured();
    }
    const body = speakBodySchema.safeParse(
      await c.req.json().catch(() => null)
    );
    if (!body.success) {
      return problem(400, "BAD_REQUEST", "Send { text } to speak.");
    }
    const result = await voice.tts.speak({
      signal: c.req.raw.signal,
      text: body.data.text,
      ...(body.data.voice ? { voice: body.data.voice } : {}),
    });
    if (!result.ok) {
      return failure(result.error);
    }
    return new Response(result.value.body, {
      headers: {
        "cache-control": "no-store",
        "content-type": result.value.contentType,
        "x-content-type-options": "nosniff",
      },
    });
  });

  app.post(VOICE_PATHS.realtime, async (c) => {
    if (!(await resolveSession(c.req.raw))) {
      return problem(401, "UNAUTHORIZED", "Sign in to continue.");
    }
    if (!voice?.realtime) {
      return notConfigured();
    }
    const result = await voice.realtime.mint({
      instructions: REALTIME_INSTRUCTIONS,
      signal: c.req.raw.signal,
      tools: [REALTIME_ASK_TOOL],
    });
    return result.ok ? c.json(result.value) : failure(result.error);
  });
};
