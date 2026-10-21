import { describe, expect, it } from "vitest";

import { callErrorOf, requestSpeech } from "./voice-engine";

const problem = (status: number, code: string) =>
  Response.json({ code, defined: false, message: "x", status }, { status });

describe("callErrorOf", () => {
  it("says the service is down only when the server says so", async () => {
    expect(
      await callErrorOf("transcribe", problem(503, "SERVICE_UNAVAILABLE"))
    ).toBe("unavailable");
    expect(
      await callErrorOf("speak", problem(503, "SERVICE_UNAVAILABLE"))
    ).toBe("unavailable");
  });

  it("blames the stage for any other failure, a bare 503 included", async () => {
    const proxy = () =>
      new Response("<html>Bad gateway</html>", { status: 503 });
    expect(await callErrorOf("transcribe", proxy())).toBe("transcription");
    expect(await callErrorOf("speak", proxy())).toBe("speech");
    expect(
      await callErrorOf("transcribe", problem(413, "PAYLOAD_TOO_LARGE"))
    ).toBe("transcription");
  });
});

describe("requestSpeech", () => {
  // A speech server that takes the request and never answers.
  const silent: typeof fetch = (_url, init) =>
    new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () =>
        reject(init.signal?.reason)
      );
    });

  it("calls a speech service that never answers unavailable", async () => {
    const spoken = await requestSpeech({
      fetch: silent,
      signal: new AbortController().signal,
      text: "Hello.",
      timeoutMs: 20,
      url: "/api/voice/speak",
    });
    expect(spoken).toEqual({ error: "unavailable", ok: false });
  });

  it("returns the audio when the service answers", async () => {
    const spoken = await requestSpeech({
      fetch: () => Promise.resolve(new Response(new Uint8Array([1, 2, 3]))),
      signal: new AbortController().signal,
      text: "Hello.",
      url: "/api/voice/speak",
    });
    expect(spoken.ok && spoken.value.byteLength).toBe(3);
  });
});
