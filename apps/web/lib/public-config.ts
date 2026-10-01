import { loadConfig } from "@workspace/config/load";
import { toPublicConfig } from "@workspace/config/public";
import type { FontsConfig } from "@workspace/config/schema";
import type { PublicConfig } from "@workspace/contract/schemas/meta";

// The public slice of `app.config.yaml` (what `GET /api/config` serves),
// computed in the page renderer so it can be inlined into the HTML (D27: no
// boot round trip). Config is read once per process; changes apply on
// restart (D18), the same as for the API.

export type PublicConfigResult =
  | {
      readonly config: PublicConfig;
      /** Server-only: the fonts the root layout applies. */
      readonly fonts: FontsConfig;
      readonly ok: true;
    }
  /** The file is invalid; the server log has the details. */
  | { readonly ok: false };

let loading: Promise<PublicConfigResult> | undefined;

const load = async (): Promise<PublicConfigResult> => {
  try {
    const loaded = await loadConfig();
    return loaded.ok
      ? {
          config: toPublicConfig(loaded.value.config, process.env),
          fonts: loaded.value.config.fonts,
          ok: true,
        }
      : { ok: false };
  } catch {
    // An unreadable file (permissions, a directory) is a bad config too.
    return { ok: false };
  }
};

export const getPublicConfig = (): Promise<PublicConfigResult> => {
  loading ??= load();
  return loading;
};
