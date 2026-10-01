import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

import { z } from "zod";

// Signed image addresses (101). The image route serves only URLs a preview
// produced: each `src` is the remote URL and an expiry, MACed with a key
// derived from the instance secret. Without the key nobody can mint one, so
// the route isn't an open proxy, and a link stops working after `ttl`.

export interface ImageSigner {
  readonly sign: (url: string) => string;
  /** The remote URL, or `null` for a forged, damaged or expired token. */
  readonly verify: (token: string) => string | null;
}

const payloadSchema = z.object({
  /** Unix seconds. */
  e: z.int(),
  u: z.url({ protocol: /^https?$/ }),
});

const KEY_LABEL = "link preview image URLs";

/**
 * The MAC key from the instance's auth secret, so links survive a restart.
 * Without one (development), a random per-process key: links then die with
 * the process, and previews are re-signed on the next request.
 */
export const imageSigningKey = (secret: string | undefined): Buffer =>
  secret
    ? createHmac("sha256", secret).update(KEY_LABEL).digest()
    : randomBytes(32);

const DEFAULT_TTL_SECONDS = 7 * 24 * 60 * 60;

export const createImageSigner = (
  key: Buffer,
  {
    now = () => new Date(),
    ttlSeconds = DEFAULT_TTL_SECONDS,
  }: { readonly now?: () => Date; readonly ttlSeconds?: number } = {}
): ImageSigner => {
  const mac = (payload: string) =>
    createHmac("sha256", key).update(payload).digest();
  const seconds = () => Math.floor(now().getTime() / 1000);
  return {
    sign: (url) => {
      const payload = Buffer.from(
        JSON.stringify({ e: seconds() + ttlSeconds, u: url })
      ).toString("base64url");
      return `${payload}.${mac(payload).toString("base64url")}`;
    },
    verify: (token) => {
      const [payload, signature, ...rest] = token.split(".");
      if (!(payload && signature) || rest.length > 0) {
        return null;
      }
      const expected = mac(payload);
      const given = Buffer.from(signature, "base64url");
      if (
        given.length !== expected.length ||
        !timingSafeEqual(given, expected)
      ) {
        return null;
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
      } catch {
        return null;
      }
      const result = payloadSchema.safeParse(parsed);
      if (!result.success || result.data.e < seconds()) {
        return null;
      }
      return result.data.u;
    },
  };
};
