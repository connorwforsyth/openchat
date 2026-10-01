import { err, ok, type Result } from "@workspace/shared/result";
import { z } from "zod";

// The instance the shell talks to is an origin: the web app lives at its
// root (apps/web), so a pasted path, query or fragment is dropped.

export const instanceUrlErrorSchema = z.enum([
  "empty",
  "invalid",
  "unsupported-protocol",
  "insecure",
]);
export type InstanceUrlError = z.infer<typeof instanceUrlErrorSchema>;

const IPV4_LOOPBACK = /^127(?:\.\d{1,3}){3}$/;

/** Hosts that never leave this machine, where plain http is fine. */
const isLoopbackHost = (hostname: string): boolean =>
  hostname === "localhost" ||
  hostname.endsWith(".localhost") ||
  hostname === "[::1]" ||
  IPV4_LOOPBACK.test(hostname);

const SCHEME = /^[a-z][a-z\d+.-]*:/i;

/**
 * Normalises what someone typed into an instance origin. A bare host gets
 * `https://`. Plain `http://` is accepted only for loopback: anything else
 * would send the session cookie in the clear.
 */
export const parseInstanceUrl = (
  input: string
): Result<string, InstanceUrlError> => {
  const trimmed = input.trim();
  if (trimmed === "") {
    return err("empty");
  }
  const withScheme = SCHEME.test(trimmed) ? trimmed : `https://${trimmed}`;
  if (!URL.canParse(withScheme)) {
    return err("invalid");
  }
  const url = new URL(withScheme);
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return err("unsupported-protocol");
  }
  if (url.hostname === "" || url.username !== "" || url.password !== "") {
    return err("invalid");
  }
  if (url.protocol === "http:" && !isLoopbackHost(url.hostname)) {
    return err("insecure");
  }
  return ok(url.origin);
};
