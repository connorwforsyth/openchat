import { z } from "zod";

// The auth-related environment (D18: secrets come from env, never the YAML).
// Every variable is optional so the app boots with an empty `.env`; what's
// missing degrades (no GitHub button, a dev-only secret) instead of crashing.

const optional = z
  .string()
  .trim()
  .optional()
  .transform((value) => (value ? value : undefined));

export const authEnvSchema = z.object({
  /** Signs session cookies and encrypts tokens. 32+ random bytes in production. */
  BETTER_AUTH_SECRET: optional,
  /**
   * Read by Better Auth itself, unchecked and patterns included; we only
   * look at it to warn. `TRUSTED_ORIGINS` is the checked equivalent (054).
   */
  BETTER_AUTH_TRUSTED_ORIGINS: optional,
  /** The public origin, like `https://chat.example.com`; inferred per request when unset. */
  BETTER_AUTH_URL: optional,
  GITHUB_CLIENT_ID: optional,
  GITHUB_CLIENT_SECRET: optional,
  GOOGLE_CLIENT_ID: optional,
  GOOGLE_CLIENT_SECRET: optional,
  NODE_ENV: optional,
  /**
   * Origins besides `BETTER_AUTH_URL` that may sign in, exactly
   * (`https://chat.example.com, http://192.168.1.20:3000`). Loopback aliases of
   * `BETTER_AUTH_URL` need no entry (054).
   */
  TRUSTED_ORIGINS: optional,
  /**
   * Proxies whose `X-Forwarded-For` entries are believed, as IP addresses and
   * CIDR ranges (`10.0.0.0/8, ::1`). Unset, only the last hop is (044).
   */
  TRUSTED_PROXIES: optional,
});
export type AuthEnv = z.infer<typeof authEnvSchema>;

/**
 * The app's own origin from `BETTER_AUTH_URL` (which may carry a base path),
 * for the trusted-origin list and for pages that say where to sign in (054).
 * `undefined` when unset or not an http(s) URL.
 */
export const appOriginOf = (appUrl: string | undefined): string | undefined => {
  const trimmed = appUrl?.trim() ?? "";
  if (!URL.canParse(trimmed)) {
    return;
  }
  const url = new URL(trimmed);
  return url.protocol === "http:" || url.protocol === "https:"
    ? url.origin
    : undefined;
};

/**
 * A fixed secret for development only. Anyone who reads this file can forge
 * sessions signed with it, so production refuses it (`resolveSecret`).
 */
export const DEV_ONLY_SECRET =
  "dev-only-insecure-secret-set-BETTER_AUTH_SECRET-before-deploying";

export const secretProblemSchema = z.discriminatedUnion("type", [
  /** Production without `BETTER_AUTH_SECRET`: auth stays off rather than run with a known key. */
  z.object({ type: z.literal("missing_secret") }),
]);
export type SecretProblem = z.infer<typeof secretProblemSchema>;

export type ResolvedSecret =
  | { readonly kind: "configured"; readonly secret: string }
  | { readonly kind: "dev_fallback"; readonly secret: string }
  | { readonly kind: "missing"; readonly problem: SecretProblem };

/** The secret to sign with: configured, the dev fallback outside production, or nothing. */
export const resolveSecret = (env: AuthEnv): ResolvedSecret => {
  if (env.BETTER_AUTH_SECRET) {
    return { kind: "configured", secret: env.BETTER_AUTH_SECRET };
  }
  if (env.NODE_ENV === "production") {
    return { kind: "missing", problem: { type: "missing_secret" } };
  }
  return { kind: "dev_fallback", secret: DEV_ONLY_SECRET };
};
