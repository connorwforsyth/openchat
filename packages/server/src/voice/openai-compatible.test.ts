import { appConfigSchema } from "@workspace/config/schema";
import { HttpResponse, http } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { createVoice } from "./from-config";
import {
  audioFileName,
  createOpenAiRealtimeSessions,
  createOpenAiSpeechToText,
  createOpenAiTextToSpeech,
  speechErrorOf,
} from "./openai-compatible";

// The OpenAI-compatible speech adapters against MSW: what they send, what
// they parse, how they fail. The same code talks to Speaches, Kokoro and
// OpenAI. Nothing leaves the process.

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const LOCAL = "http://whisper.test:8000/v1";
const OPENAI = "https://api.openai.com/v1";
const TEST_KEY = "test-key-not-real";

describe("speech to text", () => {
  it("posts the audio as a file with the model, and trims the text", async () => {
    let form: FormData | undefined;
    let auth: string | null = "unset";
    server.use(
      http.post(`${LOCAL}/audio/transcriptions`, async ({ request }) => {
        auth = request.headers.get("authorization");
        form = await request.formData();
        return HttpResponse.json({ text: "  What's on today?  " });
      })
    );
    const stt = createOpenAiSpeechToText({ baseUrl: LOCAL, model: "whisper" });
    const result = await stt.transcribe({
      audio: new Blob([new Uint8Array([1, 2, 3])], { type: "audio/webm" }),
      language: "en",
    });
    expect(result).toEqual({ ok: true, value: { text: "What's on today?" } });
    expect(auth).toBeNull();
    expect(form?.get("model")).toBe("whisper");
    expect(form?.get("language")).toBe("en");
    const file = form?.get("file");
    expect(file instanceof File ? file.name : null).toBe("utterance.webm");
  });

  it("sends the key to OpenAI", async () => {
    let auth: string | null = null;
    server.use(
      http.post(`${OPENAI}/audio/transcriptions`, ({ request }) => {
        auth = request.headers.get("authorization");
        return HttpResponse.json({ text: "hi" });
      })
    );
    const stt = createOpenAiSpeechToText({
      apiKey: TEST_KEY,
      baseUrl: OPENAI,
      model: "gpt-4o-mini-transcribe",
    });
    expect((await stt.transcribe({ audio: new Blob(["x"]) })).ok).toBe(true);
    expect(auth).toBe(`Bearer ${TEST_KEY}`);
  });

  it("maps 4xx to rejected, 5xx and network errors to unavailable", async () => {
    server.use(
      http.post(`${LOCAL}/audio/transcriptions`, () =>
        HttpResponse.text("bad audio", { status: 400 })
      )
    );
    const stt = createOpenAiSpeechToText({ baseUrl: LOCAL, model: "m" });
    const rejected = await stt.transcribe({ audio: new Blob(["x"]) });
    expect(rejected.ok ? null : rejected.error.type).toBe("rejected");

    server.use(
      http.post(`${LOCAL}/audio/transcriptions`, () => HttpResponse.error())
    );
    const down = await stt.transcribe({ audio: new Blob(["x"]) });
    expect(down.ok ? null : down.error.type).toBe("unavailable");
  });

  it("names the file by its type", () => {
    expect(audioFileName("audio/wav")).toBe("utterance.wav");
    expect(audioFileName("audio/webm;codecs=opus")).toBe("utterance.webm");
    expect(audioFileName("")).toBe("utterance.webm");
    expect(speechErrorOf(503, "x").type).toBe("unavailable");
  });
});

describe("text to speech", () => {
  it("asks for mp3 in the configured voice and streams it back", async () => {
    let body: unknown;
    server.use(
      http.post(`${LOCAL}/audio/speech`, async ({ request }) => {
        body = await request.json();
        return new HttpResponse(new Uint8Array([9, 9]), {
          headers: { "content-type": "audio/mpeg" },
        });
      })
    );
    const tts = createOpenAiTextToSpeech({
      baseUrl: LOCAL,
      model: "kokoro",
      voice: "af_heart",
    });
    const result = await tts.speak({ text: "Hello there." });
    expect(body).toEqual({
      input: "Hello there.",
      model: "kokoro",
      response_format: "mp3",
      voice: "af_heart",
    });
    if (!result.ok) {
      throw new Error("expected audio");
    }
    expect(result.value.contentType).toBe("audio/mpeg");
    const bytes = new Uint8Array(
      await new Response(result.value.body).arrayBuffer()
    );
    expect([...bytes]).toEqual([9, 9]);
  });

  it("uses a voice override", async () => {
    let voice: unknown;
    server.use(
      http.post(`${LOCAL}/audio/speech`, async ({ request }) => {
        ({ voice } = (await request.json()) as { voice: string });
        return new HttpResponse(new Uint8Array([1]));
      })
    );
    const tts = createOpenAiTextToSpeech({
      baseUrl: LOCAL,
      model: "kokoro",
      voice: "af_heart",
    });
    await tts.speak({ text: "Hi.", voice: "bm_george" });
    expect(voice).toBe("bm_george");
  });
});

describe("OpenAI Realtime", () => {
  it("mints a client secret with the tool, never returning the key", async () => {
    let body: { session: { tools: unknown[]; model: string } } | undefined;
    server.use(
      http.post(`${OPENAI}/realtime/client_secrets`, async ({ request }) => {
        body = (await request.json()) as typeof body;
        return HttpResponse.json({ expires_at: 1_900_000_000, value: "ek_1" });
      })
    );
    const sessions = createOpenAiRealtimeSessions({
      apiKey: TEST_KEY,
      baseUrl: OPENAI,
      model: "gpt-realtime",
      voice: "alloy",
    });
    const result = await sessions.mint({
      tools: [{ description: "d", name: "t", parameters: {} }],
    });
    expect(result).toEqual({
      ok: true,
      value: {
        expiresAt: 1_900_000_000,
        model: "gpt-realtime",
        secret: "ek_1",
      },
    });
    expect(body?.session.model).toBe("gpt-realtime");
    expect(body?.session.tools).toEqual([
      { description: "d", name: "t", parameters: {}, type: "function" },
    ]);
    expect(JSON.stringify(result)).not.toContain(TEST_KEY);
  });
});

describe("createVoice", () => {
  it("is off with no config, and with openai but no key", () => {
    expect(createVoice(appConfigSchema.parse({}))).toBeNull();
    expect(
      createVoice(appConfigSchema.parse({ voice: { provider: "openai" } }))
    ).toBeNull();
  });

  it("is local with both URLs", () => {
    const voice = createVoice(
      appConfigSchema.parse({
        voice: { stt: { url: LOCAL }, tts: { url: LOCAL } },
      })
    );
    expect(voice?.info).toEqual({
      enabled: true,
      maxUploadMb: 10,
      provider: "local",
      realtime: false,
    });
  });

  it("is openai with the provider's key, and offers Realtime", () => {
    const voice = createVoice(
      appConfigSchema.parse({
        providers: { openai: { apiKey: TEST_KEY } },
        voice: { provider: "openai" },
      })
    );
    expect(voice?.info.provider).toBe("openai");
    expect(voice?.info.realtime).toBe(true);
  });
});
