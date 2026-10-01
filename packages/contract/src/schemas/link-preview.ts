import { z } from "zod";

import { timestampSchema } from "./common";

// Link previews for URL sources (101). The server fetches the cited page's
// `<head>` (never the browser: a chip must not leak the reader's address to
// every site a model cites), and serves its image and favicon through our
// own image route, so `image.url` and `icon` are paths on this API's origin,
// signed by the server, never the third-party address.

/** Text a preview may carry, after markup is stripped. */
export const LINK_PREVIEW_LIMITS = {
  alt: 300,
  description: 500,
  siteName: 100,
  title: 300,
  url: 2048,
} as const;

/**
 * The image types the image route serves: raster only. SVG can carry
 * script, so it's never served (a favicon that's only SVG falls back to the
 * letter in the UI).
 */
export const LINK_PREVIEW_IMAGE_TYPES = [
  "image/avif",
  "image/bmp",
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/vnd.microsoft.icon",
  "image/webp",
  "image/x-icon",
] as const;

/** The address a preview was asked for: http(s) only. */
export const linkPreviewUrlSchema = z
  .url({ protocol: /^https?$/ })
  .max(LINK_PREVIEW_LIMITS.url);

/**
 * A path on this API's origin (`/api/link-preview/image?src=…`), resolved
 * against the base URL the client calls the API on. Never an absolute URL:
 * the browser only ever loads preview images from us.
 */
export const linkPreviewImagePathSchema = z
  .string()
  .max(8192)
  .regex(/^\/[^/\\]/, "a path on this origin");

export const linkPreviewInputSchema = z.object({
  url: linkPreviewUrlSchema,
});

export const linkPreviewSchema = z.object({
  description: z.string().max(LINK_PREVIEW_LIMITS.description).optional(),
  fetchedAt: timestampSchema,
  /** Where the page was after redirects (at most 3). */
  finalUrl: linkPreviewUrlSchema,
  /** The site's favicon, through our image route. */
  icon: linkPreviewImagePathSchema.optional(),
  /** The page's `og:image` or `twitter:image`, through our image route. */
  image: z
    .object({
      alt: z.string().max(LINK_PREVIEW_LIMITS.alt).optional(),
      height: z.int().min(1).optional(),
      url: linkPreviewImagePathSchema,
      width: z.int().min(1).optional(),
    })
    .optional(),
  siteName: z.string().max(LINK_PREVIEW_LIMITS.siteName).optional(),
  title: z.string().max(LINK_PREVIEW_LIMITS.title).optional(),
  /** The address asked for. */
  url: linkPreviewUrlSchema,
});
export type LinkPreview = z.infer<typeof linkPreviewSchema>;

/** `src` is the opaque, signed token a preview's image path carries. */
export const linkPreviewImageInputSchema = z.object({
  src: z.string().min(1).max(8192),
});
