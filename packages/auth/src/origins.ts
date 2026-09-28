import { z } from "zod";

import { appOriginOf } from "./env";

// Which browser origins may sign in (ticket 054). Better Auth refuses a
// sign-in or sign-up whose `Origin` it doesn't trust, and it trusts only
// `BETTER_AUTH_URL`, so a server set up as `http://localhost:3000` refused a
// browser that opened `http://127.0.0.1:3000`: the same machine and port
// under another name. Loopback names only ever reach this machine, so when
// the app's own origin is one, the others on the same scheme and port are
// trusted too. Every other host is trusted only exactly as configured
// (`BETTER_AUTH_URL`, `TRUSTED_ORIGINS`): no patterns, no wildcards.

/** Hostnames as `URL#hostname` spells them; IPv6 keeps its brackets. */
export const LOOPBACK_HOSTS: readonly string[] = [
  "localhost",
  "127.0.0.1",
  "[::1]",
];

const parseUrl = (value: string): URL | null =>
  URL.canParse(value) ? new URL(value) : null;

/**
 * One origin, as Better Auth compares them (`URL#origin`: lower-cased host,
 * default port dropped). Only scheme, host and port: a path, query,
 * credentials or a `*` in the host is refused, so an entry can't widen into a
 * pattern Better Auth would match loosely.
 */
export const originSchema = z
  .string()
  .trim()
  .transform((value, context) => {
    const url = parseUrl(value);
    const bare =
      url !== null &&
      (url.protocol === "http:" || url.protocol === "https:") &&
      url.username === "" &&
      url.password === "" &&
      url.pathname === "/" &&
      url.search === "" &&
      url.hash === "" &&
      !url.hostname.includes("*");
    if (!bare) {
      context.addIssue({
        code: "custom",
        message: "Expected an http(s) origin, like https://chat.example.com.",
      });
      return z.NEVER;
    }
    return url.origin;
  });

/** The origin under every loopback name when it's on one; else just itself. */
export const loopbackAliases = (origin: string): readonly string[] => {
  const url = parseUrl(origin);
  if (!(url && LOOPBACK_HOSTS.includes(url.hostname))) {
    return [origin];
  }
  return LOOPBACK_HOSTS.map((host) => {
    const alias = new URL(url.origin);
    alias.hostname = host;
    return alias.origin;
  });
};

export interface TrustedOrigins {
  /** Entries of `extra` that aren't an origin; ignored. */
  readonly invalid: readonly string[];
  readonly origins: readonly string[];
}

const SEPARATORS = /[\s,]+/;

/**
 * What Better Auth's `trustedOrigins` should hold: the app's origin (with
 * its loopback aliases) and each valid origin in `extra`, a comma- or
 * space-separated list (`TRUSTED_ORIGINS`), exactly. Pure.
 */
export const trustedOriginsFor = ({
  appUrl,
  extra,
}: {
  readonly appUrl?: string;
  readonly extra?: string;
}): TrustedOrigins => {
  const app = appOriginOf(appUrl);
  const invalid: string[] = [];
  const listed: string[] = [];
  for (const entry of (extra ?? "").split(SEPARATORS)) {
    if (entry === "") {
      continue;
    }
    const parsed = originSchema.safeParse(entry);
    if (parsed.success) {
      listed.push(parsed.data);
    } else {
      invalid.push(entry);
    }
  }
  const origins = [...(app ? loopbackAliases(app) : []), ...listed];
  return { invalid, origins: [...new Set(origins)] };
};
