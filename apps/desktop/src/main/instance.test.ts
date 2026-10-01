import { describe, expect, it } from "vitest";

import { checkInstance, type Fetch } from "./instance";

const publicConfig = {
  auth: { providers: [], signup: "invite" },
  brand: { faviconUrl: null, logoUrl: null, name: "Team Chat" },
  features: {},
  limits: { memoryMaxChars: 2000, uploadMaxMb: 20 },
  policies: { chatContexts: ["personal"] },
  sandbox: { default: null, providers: [] },
};

const answering =
  (body: unknown, ok = true): Fetch =>
  (url) => {
    calls.push(url);
    return Promise.resolve({ json: () => Promise.resolve(body), ok });
  };

let calls: string[] = [];

describe("checkInstance", () => {
  it("reads the public config and returns the origin and brand", async () => {
    calls = [];
    const result = await checkInstance(
      "chat.example.com/c/1",
      answering(publicConfig)
    );
    expect(result).toEqual({
      ok: true,
      value: { name: "Team Chat", origin: "https://chat.example.com" },
    });
    expect(calls).toEqual(["https://chat.example.com/api/config"]);
  });

  it("refuses a bad address without fetching", async () => {
    calls = [];
    const result = await checkInstance(
      "http://chat.example.com",
      answering(publicConfig)
    );
    expect(result).toEqual({ error: "insecure", ok: false });
    expect(calls).toEqual([]);
  });

  it("says a server that answers something else isn't an instance", async () => {
    expect(
      await checkInstance("https://example.com", answering({ hello: "world" }))
    ).toEqual({ error: "not-an-instance", ok: false });
    expect(
      await checkInstance("https://example.com", answering(publicConfig, false))
    ).toEqual({ error: "not-an-instance", ok: false });
  });

  it("says an unreachable server is unreachable", async () => {
    const failing: Fetch = () => Promise.reject(new TypeError("fetch failed"));
    expect(await checkInstance("https://example.com", failing)).toEqual({
      error: "unreachable",
      ok: false,
    });
  });
});
