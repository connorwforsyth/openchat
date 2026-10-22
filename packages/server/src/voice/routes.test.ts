import type { UserId } from "@workspace/contract/schemas/common";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";

import {
  createMemorySpeechToText,
  createMemoryTextToSpeech,
} from "../ports/speech.memory";
import type { Voice } from "./from-config";
import type { RealtimeSessions } from "./openai-compatible";
import { mountVoiceRoutes, VOICE_PATHS } from "./routes";

// The voice routes in-process (`app.request`), over the in-memory speech
// ports: signed-in only, audio in and text out, text in and audio out.

const USER = "x-test-user";

const build = (voice: Voice | null) => {
  const app = new Hono();
  mountVoiceRoutes(app, {
    resolveSession: (request) => {
      const id = request.headers.get(USER);
      return Promise.resolve(id ? { userId: id as UserId } : null);
    },
    voice,
  });
  return app;
};

const fakeVoice = (realtime: RealtimeSessions | null = null) => {
  const stt = createMemorySpeechToText(() => "What's next on my schedule?");
  const tts = createMemoryTextToSpeech();
  const voice: Voice = {
    info: {
      enabled: true,
      maxUploadMb: 1,
      provider: "local",
      realtime: realtime !== null,
    },
    realtime,
    stt,
    tts,
  };
  return { stt, tts, voice };
};

const signedIn = { [USER]: "user-1" };

describe("voice routes", () => {
  it("needs a session", async () => {
    const app = build(fakeVoice().voice);
    const statuses = await Promise.all(
      (
        [
          [VOICE_PATHS.info, "GET"],
          [VOICE_PATHS.transcribe, "POST"],
          [VOICE_PATHS.speak, "POST"],
          [VOICE_PATHS.realtime, "POST"],
        ] as const
      ).map(
        async ([path, method]) => (await app.request(path, { method })).status
      )
    );
    expect(statuses).toEqual([401, 401, 401, 401]);
  });

  it("says voice is off, and 404s, when unconfigured", async () => {
    const app = build(null);
    const info = await app.request(VOICE_PATHS.info, { headers: signedIn });
    expect(await info.json()).toMatchObject({ enabled: false });
    const speak = await app.request(VOICE_PATHS.speak, {
      body: JSON.stringify({ text: "hi" }),
      headers: signedIn,
      method: "POST",
    });
    expect(speak.status).toBe(404);
  });

  it("transcribes audio bytes", async () => {
    const { stt, voice } = fakeVoice();
    const response = await build(voice).request(VOICE_PATHS.transcribe, {
      body: new Uint8Array([1, 2, 3]),
      headers: { ...signedIn, "content-type": "audio/webm;codecs=opus" },
      method: "POST",
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      text: "What's next on my schedule?",
    });
    expect(stt.heard[0]?.type).toBe("audio/webm;codecs=opus");
    expect(stt.heard[0]?.size).toBe(3);
  });

  it("refuses non-audio, empty and oversized uploads", async () => {
    const app = build(fakeVoice().voice);
    const send = (body: Uint8Array<ArrayBuffer>, type: string) =>
      app.request(VOICE_PATHS.transcribe, {
        body,
        headers: { ...signedIn, "content-type": type },
        method: "POST",
      });
    expect((await send(new Uint8Array([1]), "text/plain")).status).toBe(415);
    expect((await send(new Uint8Array([]), "audio/wav")).status).toBe(400);
    expect(
      (await send(new Uint8Array(1024 * 1024 + 1), "audio/wav")).status
    ).toBe(413);
  });

  it("speaks text as audio", async () => {
    const { tts, voice } = fakeVoice();
    const response = await build(voice).request(VOICE_PATHS.speak, {
      body: JSON.stringify({ text: "On it." }),
      headers: signedIn,
      method: "POST",
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("audio/x-fake");
    expect(await response.text()).toBe("On it.");
    expect(tts.spoken).toEqual(["On it."]);
  });

  it("refuses empty text and odd voice names", async () => {
    const app = build(fakeVoice().voice);
    const statuses = await Promise.all(
      [{ text: "  " }, { text: "a", voice: "../x" }, {}].map(
        async (body) =>
          (
            await app.request(VOICE_PATHS.speak, {
              body: JSON.stringify(body),
              headers: signedIn,
              method: "POST",
            })
          ).status
      )
    );
    expect(statuses).toEqual([400, 400, 400]);
  });

  it("answers 503 when the service is down", async () => {
    const voice: Voice = {
      ...fakeVoice().voice,
      tts: createMemoryTextToSpeech({ message: "down", type: "unavailable" }),
    };
    const response = await build(voice).request(VOICE_PATHS.speak, {
      body: JSON.stringify({ text: "hi" }),
      headers: signedIn,
      method: "POST",
    });
    expect(response.status).toBe(503);
  });

  it("mints a Realtime secret only when the provider has one", async () => {
    expect(
      (
        await build(fakeVoice().voice).request(VOICE_PATHS.realtime, {
          headers: signedIn,
          method: "POST",
        })
      ).status
    ).toBe(404);
    const calls: string[] = [];
    const realtime: RealtimeSessions = {
      mint: ({ tools }) => {
        calls.push(tools?.[0]?.name ?? "");
        return Promise.resolve({
          ok: true,
          value: { expiresAt: 1, model: "gpt-realtime", secret: "ek_1" },
        });
      },
    };
    const response = await build(fakeVoice(realtime).voice).request(
      VOICE_PATHS.realtime,
      { headers: signedIn, method: "POST" }
    );
    expect(await response.json()).toEqual({
      expiresAt: 1,
      model: "gpt-realtime",
      secret: "ek_1",
    });
    expect(calls).toEqual(["ask_assistant"]);
  });
});
