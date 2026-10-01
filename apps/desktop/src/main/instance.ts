import { publicConfigSchema } from "@workspace/contract/schemas/meta";
import { err, ok } from "@workspace/shared/result";

import { parseInstanceUrl } from "../shared/instance-url";
import type { ConnectResult } from "../shared/ipc";

/** The slice of `fetch` this needs; a port, so tests pass a fake. */
export type Fetch = (
  url: string,
  init: { readonly signal: AbortSignal }
) => Promise<{ readonly ok: boolean; json: () => Promise<unknown> }>;

const TIMEOUT_MS = 10_000;

// Only what the shell needs, so an older or newer server still passes.
const instanceConfigSchema = publicConfigSchema.pick({ brand: true });

/**
 * Checks that a URL is a running instance before the shell commits to it:
 * its public config (`GET /api/config`, readable signed out) must carry a
 * brand. The
 * brand name comes back with it, for the window (D18).
 */
export const checkInstance = async (
  input: string,
  fetch: Fetch
): Promise<ConnectResult> => {
  const parsed = parseInstanceUrl(input);
  if (!parsed.ok) {
    return parsed;
  }
  const origin = parsed.value;
  let body: unknown;
  try {
    const response = await fetch(`${origin}/api/config`, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) {
      return err("not-an-instance");
    }
    body = await response.json();
  } catch {
    return err("unreachable");
  }
  const config = instanceConfigSchema.safeParse(body);
  return config.success
    ? ok({ name: config.data.brand.name, origin })
    : err("not-an-instance");
};
