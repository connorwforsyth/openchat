import { implement, ORPCError } from "@orpc/server";
import { contract } from "@workspace/contract/contract";
import { baseErrors, featureError } from "@workspace/contract/errors";

import type { RequestContext } from "../context";
import type { RateLimiter } from "./rate-limit";
import type { LinkPreviewService } from "./service";

// The `linkPreviews` procedure group (101). Both need a signed-in user, both
// are rate-limited per user, and both answer `FEATURE_DISABLED` without
// fetching anything when `features.linkPreviews` is off.

export interface LinkPreviewRouterDeps {
  /** `features.linkPreviews`. */
  readonly enabled: boolean;
  readonly limits: {
    readonly images: RateLimiter;
    readonly previews: RateLimiter;
  };
  readonly service: LinkPreviewService;
}

/**
 * The image's headers: inline for `<img>`, but inert if opened directly (no
 * sniffing, a CSP that allows nothing, same-origin only), and cached by the
 * browser for a day, privately.
 */
export const IMAGE_HEADERS = {
  "cache-control": "private, max-age=86400, immutable",
  "content-disposition": 'inline; filename="preview"',
  "content-security-policy": "default-src 'none'; sandbox",
  "cross-origin-resource-policy": "same-origin",
  "x-content-type-options": "nosniff",
} as const;

export const createLinkPreviewRouter = ({
  enabled,
  limits,
  service,
}: LinkPreviewRouterDeps) => {
  const os = implement(contract).$context<RequestContext>();
  const signedIn = os.use(({ context, next }) => {
    if (!context.session) {
      throw new ORPCError("UNAUTHORIZED", baseErrors.UNAUTHORIZED);
    }
    if (!enabled) {
      throw new ORPCError("FEATURE_DISABLED", {
        ...featureError.FEATURE_DISABLED,
        data: { feature: "linkPreviews" },
      });
    }
    return next({ context: { userId: context.session.userId } });
  });

  const limit = (limiter: RateLimiter, userId: string) => {
    const allowed = limiter(userId);
    if (!allowed.ok) {
      throw new ORPCError("RATE_LIMITED", {
        ...baseErrors.RATE_LIMITED,
        data: { retryAfterSeconds: allowed.retryAfterSeconds },
      });
    }
  };

  const notFound = () => new ORPCError("NOT_FOUND", baseErrors.NOT_FOUND);

  return {
    linkPreviews: {
      get: signedIn.linkPreviews.get.handler(async ({ context, input }) => {
        limit(limits.previews, context.userId);
        const preview = await service.preview(input.url);
        if (!preview) {
          throw notFound();
        }
        return preview;
      }),

      image: signedIn.linkPreviews.image.handler(async ({ context, input }) => {
        limit(limits.images, context.userId);
        const image = await service.image(input.src);
        if (!image) {
          throw notFound();
        }
        return {
          body: new File([image.bytes], "preview", {
            type: image.contentType,
          }),
          headers: IMAGE_HEADERS,
        };
      }),
    },
  };
};
