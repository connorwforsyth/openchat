import { randomBytes } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import {
  isStale,
  keyIdOf,
  keyRingOf,
  loadKeyRing,
  mcpOauthTokenAad,
  open,
  seal,
} from "./crypto";

const expectRing = (result: ReturnType<typeof loadKeyRing>) => {
  if (!result.ok) {
    throw new Error(result.error.type);
  }
  return result.value;
};

describe("seal / open", () => {
  const keys = keyRingOf(randomBytes(32));
  const aad = mcpOauthTokenAad("server", "user");

  it("round-trips and never stores the plaintext", () => {
    const sealed = seal(keys, "tok_plain_value", aad);
    expect(sealed.keyId).toBe(keys.current.id);
    expect(sealed.ciphertext).not.toContain("tok_plain_value");
    expect(open(keys, sealed, aad)).toEqual({
      ok: true,
      value: "tok_plain_value",
    });
    // A fresh IV every time.
    expect(seal(keys, "tok_plain_value", aad).ciphertext).not.toBe(
      sealed.ciphertext
    );
  });

  it("refuses another purpose, a tampered ciphertext and an unknown key", () => {
    const sealed = seal(keys, "secret", aad);
    expect(open(keys, sealed, mcpOauthTokenAad("server", "other"))).toEqual({
      error: { type: "decrypt_failed" },
      ok: false,
    });
    const flipped = `${sealed.ciphertext.slice(0, -2)}${sealed.ciphertext.endsWith("A") ? "B" : "A"}A`;
    expect(open(keys, { ...sealed, ciphertext: flipped }, aad).ok).toBe(false);
    expect(open(keyRingOf(randomBytes(32)), sealed, aad)).toMatchObject({
      error: { type: "unknown_key_id" },
    });
  });
});

describe("loadKeyRing", () => {
  const oldKey = randomBytes(32);
  const newKey = randomBytes(32);

  it("reads base64 or hex and rotates through ENCRYPTION_KEY_PREVIOUS", () => {
    const before = expectRing(
      loadKeyRing({ ENCRYPTION_KEY: oldKey.toString("base64") })
    );
    const sealed = seal(before, "secret", "purpose");

    const after = expectRing(
      loadKeyRing({
        ENCRYPTION_KEY: newKey.toString("hex"),
        ENCRYPTION_KEY_PREVIOUS: oldKey.toString("base64"),
      })
    );
    expect(after.current.id).toBe(keyIdOf(newKey));
    expect(isStale(after, sealed)).toBe(true);
    expect(open(after, sealed, "purpose")).toEqual({
      ok: true,
      value: "secret",
    });
    expect(isStale(after, seal(after, "secret", "purpose"))).toBe(false);
  });

  it("fails clearly in production and falls back with a warning elsewhere", () => {
    expect(loadKeyRing({ NODE_ENV: "production" })).toMatchObject({
      error: { type: "missing_key" },
      ok: false,
    });
    const warn = vi.fn();
    const dev = expectRing(loadKeyRing({}, { warn }));
    expect(dev.insecure).toBe(true);
    expect(warn).toHaveBeenCalledOnce();

    // Secrets sealed on the development key survive setting a real one.
    const sealed = seal(dev, "secret", "purpose");
    const real = expectRing(
      loadKeyRing({ ENCRYPTION_KEY: newKey.toString("base64") })
    );
    expect(open(real, sealed, "purpose").ok).toBe(true);
  });

  it("rejects keys that aren't 32 bytes, without echoing them", () => {
    const result = loadKeyRing({ ENCRYPTION_KEY: "hunter2" });
    expect(result).toMatchObject({ error: { type: "invalid_key" } });
    expect(JSON.stringify(result)).not.toContain("hunter2");
    expect(
      loadKeyRing({
        ENCRYPTION_KEY: newKey.toString("base64"),
        ENCRYPTION_KEY_PREVIOUS: "short",
      }).ok
    ).toBe(false);
  });
});
