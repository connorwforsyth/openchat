import { egressHostSchema } from "@workspace/config/schema";
import { z } from "zod";

// Where a sandbox may connect (D7), as `web` sends it with each create so
// `sandbox.egress` in app.config.yaml is the one source of truth. Under
// `allowlist` the sandbox has no route out except the runner's forward
// proxy, which asks `hostAllowed` about every connection.

export const egressPolicySchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("none") }),
  z.object({ mode: z.literal("open") }),
  z.object({
    allow: z.array(egressHostSchema).max(256),
    mode: z.literal("allowlist"),
  }),
]);
export type EgressPolicy = z.infer<typeof egressPolicySchema>;

/** The policy for `sandbox.egress`; the list matters only under `allowlist`. */
export const egressPolicyFor = (egress: {
  readonly allow: readonly string[];
  readonly mode: EgressPolicy["mode"];
}): EgressPolicy =>
  egress.mode === "allowlist"
    ? { allow: [...egress.allow], mode: "allowlist" }
    : { mode: egress.mode };

const TRAILING_DOT = /\.$/;

/**
 * Whether `host` is on the list: an exact entry, or a `*.suffix` entry for
 * any subdomain of `suffix` (not `suffix` itself). Case and a trailing dot
 * don't matter; IP literals match only if listed exactly. Pure.
 */
export const hostAllowed = (
  host: string,
  allow: readonly string[]
): boolean => {
  const name = host.toLowerCase().replace(TRAILING_DOT, "");
  if (!name) {
    return false;
  }
  return allow.some((entry) =>
    entry.startsWith("*.")
      ? name.endsWith(entry.slice(1)) && name.length > entry.length - 1
      : name === entry
  );
};
