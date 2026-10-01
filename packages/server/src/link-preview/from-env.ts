import type { AppConfig } from "@workspace/config/schema";

import { createRateLimiter } from "./rate-limit";
import { createLinkPreviewRouter } from "./router";
import { safeFetch, systemResolve } from "./safe-fetch";
import { createLinkPreviewService } from "./service";
import { createImageSigner, imageSigningKey } from "./signing";
import { testAllowOrigins } from "./test-allowlist";

// The `linkPreviews` group as the server boots it (101): the guarded
// fetcher on the system resolver, images signed with a key derived from
// BETTER_AUTH_SECRET, in-memory caches, and per-user limits.

/** Per user per minute. A chat's sources load a preview, an icon and an image each. */
export const PREVIEWS_PER_MINUTE = 120;
export const IMAGES_PER_MINUTE = 300;

type Env = Readonly<Record<string, string | undefined>>;

export const linkPreviewsFromEnv = ({
  config,
  env,
  log,
}: {
  readonly config: Pick<AppConfig, "features">;
  readonly env: Env;
  readonly log: (message: string) => void;
}) => {
  const allowOrigins = testAllowOrigins(env, log);
  return createLinkPreviewRouter({
    enabled: config.features.linkPreviews,
    limits: {
      images: createRateLimiter({ limit: IMAGES_PER_MINUTE, windowMs: 60_000 }),
      previews: createRateLimiter({
        limit: PREVIEWS_PER_MINUTE,
        windowMs: 60_000,
      }),
    },
    service: createLinkPreviewService({
      fetch: (url, policy) =>
        safeFetch(url, policy, { allowOrigins, resolve: systemResolve }),
      signer: createImageSigner(
        imageSigningKey(env.BETTER_AUTH_SECRET?.trim() || undefined)
      ),
    }),
  });
};
