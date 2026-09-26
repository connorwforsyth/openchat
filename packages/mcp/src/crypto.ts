import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";

import { err, ok, type Result } from "@workspace/shared/result";
import { z } from "zod";

// Secrets at rest (D24): AES-256-GCM under `ENCRYPTION_KEY`. Each ciphertext
// is stored with the id of the key that sealed it, so the key can rotate:
// put the new key in ENCRYPTION_KEY, the old one in ENCRYPTION_KEY_PREVIOUS,
// and anything sealed under the old one still opens (and is resealed under
// the new one the next time it's written). The id is a short fingerprint of
// the key, so there's nothing else to configure.
//
// Every seal takes a purpose string (`aad`), bound into the GCM tag, so a
// ciphertext copied from one row or column into another fails to open.
//
// Missing key: production refuses (a clear error, and the features that need
// secrets degrade); anywhere else a fixed development key stands in, with a
// warning, so a fresh checkout works with an empty `.env`.

export const sealedSecretSchema = z.object({
  ciphertext: z.string().min(1),
  keyId: z.string().min(1),
});
export type SealedSecret = z.infer<typeof sealedSecretSchema>;

export const cryptoErrorSchema = z.discriminatedUnion("type", [
  z.object({ message: z.string(), type: z.literal("missing_key") }),
  z.object({ message: z.string(), type: z.literal("invalid_key") }),
  z.object({ keyId: z.string(), type: z.literal("unknown_key_id") }),
  /** Wrong key material, a tampered ciphertext, or the wrong purpose. */
  z.object({ type: z.literal("decrypt_failed") }),
]);
export type CryptoError = z.infer<typeof cryptoErrorSchema>;

export interface KeyRing {
  readonly current: { readonly id: string; readonly key: Buffer };
  /** True when running on the development fallback key. */
  readonly insecure: boolean;
  /** Every key that can open a secret, the current one included. */
  readonly keys: ReadonlyMap<string, Buffer>;
}

const KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const FORMAT = "v1";
const HEX_KEY = /^[0-9a-f]{64}$/i;
const DEV_KEY_ID = "dev";
// Public on purpose: it only exists so development works without setup.
const DEV_KEY = createHash("sha256")
  .update("development-only encryption key; set ENCRYPTION_KEY")
  .digest();

const KEY_HELP =
  "ENCRYPTION_KEY must be 32 random bytes, base64 or hex (`openssl rand -base64 32`).";

/** A key's id: the start of its SHA-256, enough to tell keys apart, useless to an attacker. */
export const keyIdOf = (key: Buffer): string =>
  createHash("sha256").update(key).digest("hex").slice(0, 12);

export const parseKey = (text: string): Result<Buffer, CryptoError> => {
  const trimmed = text.trim();
  const key = HEX_KEY.test(trimmed)
    ? Buffer.from(trimmed, "hex")
    : Buffer.from(trimmed, "base64");
  return key.length === KEY_BYTES
    ? ok(key)
    : err({ message: KEY_HELP, type: "invalid_key" });
};

export interface KeyRingEnv {
  readonly ENCRYPTION_KEY?: string;
  /** Comma-separated keys that can still open secrets but never seal new ones. */
  readonly ENCRYPTION_KEY_PREVIOUS?: string;
  readonly NODE_ENV?: string;
}

export const loadKeyRing = (
  env: KeyRingEnv,
  options: { readonly warn?: (message: string) => void } = {}
): Result<KeyRing, CryptoError> => {
  const previous: Buffer[] = [];
  for (const text of (env.ENCRYPTION_KEY_PREVIOUS ?? "").split(",")) {
    if (text.trim() === "") {
      continue;
    }
    const parsed = parseKey(text);
    if (!parsed.ok) {
      return err({
        message: `ENCRYPTION_KEY_PREVIOUS: ${KEY_HELP}`,
        type: "invalid_key",
      });
    }
    previous.push(parsed.value);
  }

  const configured = env.ENCRYPTION_KEY?.trim();
  if (!configured) {
    if (env.NODE_ENV === "production") {
      return err({
        message: `ENCRYPTION_KEY is not set, so secrets (MCP OAuth tokens, header secrets) can't be stored. ${KEY_HELP}`,
        type: "missing_key",
      });
    }
    options.warn?.(
      "ENCRYPTION_KEY is not set; using the insecure development key. Set it before storing real secrets."
    );
    return ok(ring({ id: DEV_KEY_ID, key: DEV_KEY }, previous, true));
  }
  const current = parseKey(configured);
  if (!current.ok) {
    return current;
  }
  return ok(
    ring({ id: keyIdOf(current.value), key: current.value }, previous, false)
  );
};

const ring = (
  current: KeyRing["current"],
  previous: readonly Buffer[],
  insecure: boolean
): KeyRing => ({
  current,
  insecure,
  keys: new Map([
    ...previous.map((key) => [keyIdOf(key), key] as const),
    // Secrets sealed in development stay readable after a key is set.
    [DEV_KEY_ID, DEV_KEY],
    [current.id, current.key],
  ]),
});

/** A ring holding exactly `key`, for tests and tools. */
export const keyRingOf = (key: Buffer): KeyRing =>
  ring({ id: keyIdOf(key), key }, [], false);

export const seal = (
  keys: KeyRing,
  plaintext: string,
  aad: string
): SealedSecret => {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", keys.current.key, iv);
  cipher.setAAD(Buffer.from(aad, "utf8"));
  const body = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const payload = Buffer.concat([iv, cipher.getAuthTag(), body]);
  return {
    ciphertext: `${FORMAT}.${payload.toString("base64url")}`,
    keyId: keys.current.id,
  };
};

export const open = (
  keys: KeyRing,
  sealed: SealedSecret,
  aad: string
): Result<string, CryptoError> => {
  const key = keys.keys.get(sealed.keyId);
  if (!key) {
    return err({ keyId: sealed.keyId, type: "unknown_key_id" });
  }
  const [format, encoded] = sealed.ciphertext.split(".");
  if (format !== FORMAT || encoded === undefined) {
    return err({ type: "decrypt_failed" });
  }
  const payload = Buffer.from(encoded, "base64url");
  if (payload.length < IV_BYTES + TAG_BYTES) {
    return err({ type: "decrypt_failed" });
  }
  try {
    const decipher = createDecipheriv(
      "aes-256-gcm",
      key,
      payload.subarray(0, IV_BYTES)
    );
    decipher.setAAD(Buffer.from(aad, "utf8"));
    decipher.setAuthTag(payload.subarray(IV_BYTES, IV_BYTES + TAG_BYTES));
    const plain = Buffer.concat([
      decipher.update(payload.subarray(IV_BYTES + TAG_BYTES)),
      decipher.final(),
    ]);
    return ok(plain.toString("utf8"));
  } catch {
    return err({ type: "decrypt_failed" });
  }
};

/** Sealed under an older key: worth resealing the next time it's written. */
export const isStale = (keys: KeyRing, sealed: SealedSecret): boolean =>
  sealed.keyId !== keys.current.id;

// Purposes, shared with the writers (ticket 017 seals header secrets).

/** The `aad` for an MCP server's header secret (`mcp_server.secret_ciphertext`). */
export const MCP_HEADER_SECRET_AAD = "mcp_server.secret";

/** The `aad` for one user's OAuth tokens for one server (`mcp_oauth_token`). */
export const mcpOauthTokenAad = (serverId: string, userId: string): string =>
  `mcp_oauth_token:${serverId}:${userId}`;
