import { describe, expect, it } from "vitest";

import { createImageSigner, imageSigningKey } from "./signing";

describe("image signing", () => {
  const key = imageSigningKey("an instance secret");

  it("round-trips a URL it signed", () => {
    const signer = createImageSigner(key);
    const token = signer.sign("https://cdn.example.test/a.png");
    expect(signer.verify(token)).toBe("https://cdn.example.test/a.png");
  });

  it("is stable across restarts with the same secret, and not with another", () => {
    const token = createImageSigner(key).sign("https://a.example.test/i.png");
    expect(
      createImageSigner(imageSigningKey("an instance secret")).verify(token)
    ).toBe("https://a.example.test/i.png");
    expect(
      createImageSigner(imageSigningKey("another secret")).verify(token)
    ).toBeNull();
  });

  it("refuses unsigned, tampered and forged tokens", () => {
    const signer = createImageSigner(key);
    const token = signer.sign("https://a.example.test/i.png");
    const [payload = "", signature = ""] = token.split(".");
    const forged = Buffer.from(
      JSON.stringify({ e: 9_999_999_999, u: "http://169.254.169.254/" })
    ).toString("base64url");
    for (const bad of [
      "",
      "https://a.example.test/i.png",
      payload,
      `${payload}.`,
      `${forged}.${signature}`,
      `${payload}.${signature}x`,
      `${payload}.${signature}.extra`,
      `${payload.slice(1)}.${signature}`,
    ]) {
      expect(signer.verify(bad)).toBeNull();
    }
  });

  it("refuses an expired token", () => {
    let now = new Date("2026-10-01T00:00:00Z");
    const signer = createImageSigner(key, { now: () => now, ttlSeconds: 60 });
    const token = signer.sign("https://a.example.test/i.png");
    now = new Date("2026-10-01T00:00:59Z");
    expect(signer.verify(token)).not.toBeNull();
    now = new Date("2026-10-01T00:01:01Z");
    expect(signer.verify(token)).toBeNull();
  });

  it("uses a random key when there's no secret", () => {
    const token = createImageSigner(imageSigningKey(undefined)).sign(
      "https://a.example.test/i.png"
    );
    expect(
      createImageSigner(imageSigningKey(undefined)).verify(token)
    ).toBeNull();
  });
});
