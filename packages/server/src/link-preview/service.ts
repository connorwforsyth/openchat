import { createHash } from "node:crypto";

import type { LinkPreview } from "@workspace/contract/schemas/link-preview";
import {
  LINK_PREVIEW_IMAGE_TYPES,
  LINK_PREVIEW_LIMITS,
} from "@workspace/contract/schemas/link-preview";
import type { AsyncResult } from "@workspace/shared/result";

import { createLruCache, type TtlCache } from "./cache";
import { type PreviewImageType, sniffImageType } from "./image-type";
import { decodeHtml, type HeadPreview, parseHead } from "./parse-head";
import type { Fetched, FetchFailure, FetchPolicy } from "./safe-fetch";
import type { ImageSigner } from "./signing";

// Link previews (101): fetch a page's head, parse it, cache the answer, and
// hand back image addresses on our own route, signed so that route serves
// nothing else. Images are fetched (through the same guarded fetcher) when
// the browser asks for them, checked by their bytes, and cached by the hash
// of their URL.

/** The guarded fetcher (`safeFetch` bound to its deps). */
export type PreviewFetch = (
  url: string,
  policy: FetchPolicy
) => AsyncResult<Fetched, FetchFailure>;

export interface PreviewImage {
  readonly bytes: Uint8Array<ArrayBuffer>;
  readonly contentType: PreviewImageType;
}

export interface LinkPreviewService {
  /** The image a preview signed, or `null` (bad token, failed, not an image). */
  readonly image: (src: string) => Promise<PreviewImage | null>;
  /** The address's preview, or `null` when there isn't one. */
  readonly preview: (url: string) => Promise<LinkPreview | null>;
}

export const PREVIEW_TTL_MS = 24 * 60 * 60 * 1000;
export const FAILURE_TTL_MS = 60 * 60 * 1000;
export const HTML_MAX_BYTES = 1024 * 1024;
export const IMAGE_MAX_BYTES = 2 * 1024 * 1024;

/** Where the image route is mounted; `app.ts` serves the API under `/api`. */
export const IMAGE_ROUTE = "/api/link-preview/image";

const HTML_TYPES = new Set(["application/xhtml+xml", "text/html"]);
const IMAGE_TYPES = new Set<string>([
  ...LINK_PREVIEW_IMAGE_TYPES,
  // Common mislabels of what the bytes then prove to be one of the above.
  "application/octet-stream",
  "image/jpg",
  "image/ico",
]);

export const HTML_POLICY: FetchPolicy = {
  accept: (type) => HTML_TYPES.has(type),
  acceptHeader: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.1",
  maxBytes: HTML_MAX_BYTES,
  overflow: "truncate",
  stopAt: "</head>",
};

export const IMAGE_POLICY: FetchPolicy = {
  accept: (type) => IMAGE_TYPES.has(type),
  acceptHeader: "image/avif,image/webp,image/png,image/jpeg,image/*;q=0.8",
  maxBytes: IMAGE_MAX_BYTES - 1,
  overflow: "refuse",
};

export interface LinkPreviewServiceOptions {
  readonly fetch: PreviewFetch;
  /** Image bytes held in memory, across all images. */
  readonly imageCacheBytes?: number;
  readonly now?: () => Date;
  /** How many previews to keep. */
  readonly previewCacheEntries?: number;
  readonly signer: ImageSigner;
}

/** A preview as cached: its image and icon still the remote URLs. */
type CachedPreview = HeadPreview & {
  readonly fetchedAt: string;
  readonly finalUrl: string;
  readonly url: string;
};

const imagePath = (signer: ImageSigner, url: string) =>
  `${IMAGE_ROUTE}?src=${encodeURIComponent(signer.sign(url))}`;

const hashOf = (url: string) => createHash("sha256").update(url).digest("hex");

/** Concurrent asks for the same key share one fetch. */
const singleFlight = <T>() => {
  const running = new Map<string, Promise<T>>();
  return (key: string, run: () => Promise<T>): Promise<T> => {
    const existing = running.get(key);
    if (existing) {
      return existing;
    }
    const started = run().finally(() => running.delete(key));
    running.set(key, started);
    return started;
  };
};

export const createLinkPreviewService = ({
  fetch,
  imageCacheBytes = 32 * 1024 * 1024,
  now = () => new Date(),
  previewCacheEntries = 5000,
  signer,
}: LinkPreviewServiceOptions): LinkPreviewService => {
  // `null` caches a failure, so a dead link isn't refetched for an hour.
  const pages: TtlCache<CachedPreview | null> = createLruCache({
    maxSize: previewCacheEntries,
    now: () => now().getTime(),
  });
  const images: TtlCache<PreviewImage | null> = createLruCache({
    maxSize: imageCacheBytes,
    now: () => now().getTime(),
    sizeOf: (image) => Math.max(1, image?.bytes.byteLength ?? 0),
  });
  const pageFlight = singleFlight<LinkPreview | null>();
  const imageFlight = singleFlight<PreviewImage | null>();

  // The cache holds remote URLs; image addresses are signed per answer, so
  // a cached preview never hands out an expired one.
  const withSignedImages = (cached: CachedPreview): LinkPreview => ({
    ...cached,
    ...(cached.icon ? { icon: imagePath(signer, cached.icon) } : {}),
    ...(cached.image
      ? { image: { ...cached.image, url: imagePath(signer, cached.image.url) } }
      : {}),
  });

  const load = async (url: string): Promise<CachedPreview | null> => {
    const fetched = await fetch(url, HTML_POLICY);
    if (!fetched.ok) {
      return null;
    }
    const { body, charset, finalUrl } = fetched.value;
    const head = parseHead(decodeHtml(body, charset), finalUrl);
    return {
      ...head,
      fetchedAt: now().toISOString(),
      // A redirect can land somewhere longer than the contract allows.
      finalUrl:
        finalUrl.href.length <= LINK_PREVIEW_LIMITS.url ? finalUrl.href : url,
      url,
    };
  };

  return {
    image: async (src) => {
      const url = signer.verify(src);
      if (!url) {
        return null;
      }
      const key = hashOf(url);
      const cached = images.get(key);
      if (cached !== undefined) {
        return cached;
      }
      return await imageFlight(key, async () => {
        const fetched = await fetch(url, IMAGE_POLICY);
        const contentType = fetched.ok
          ? sniffImageType(fetched.value.body)
          : null;
        const image =
          fetched.ok && contentType
            ? { bytes: fetched.value.body, contentType }
            : null;
        images.set(key, image, image ? PREVIEW_TTL_MS : FAILURE_TTL_MS);
        return image;
      });
    },

    preview: async (url) => {
      const cached = pages.get(url);
      if (cached !== undefined) {
        return cached && withSignedImages(cached);
      }
      return await pageFlight(url, async () => {
        const loaded = await load(url);
        pages.set(url, loaded, loaded ? PREVIEW_TTL_MS : FAILURE_TTL_MS);
        return loaded && withSignedImages(loaded);
      });
    },
  };
};
