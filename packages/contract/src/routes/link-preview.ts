import { z } from "zod";

import { featureError } from "../errors";
import {
  LINK_PREVIEW_IMAGE_TYPES,
  linkPreviewImageInputSchema,
  linkPreviewInputSchema,
  linkPreviewSchema,
} from "../schemas/link-preview";
import { authed } from "./base";

// Link previews for URL sources (101). Read-only, for signed-in users, and
// rate-limited per user. `NOT_FOUND` means "no preview": the address is
// blocked (a private network), didn't answer in time, isn't HTML, or failed.

/** The image route's response: the bytes, and headers that keep them inert. */
const linkPreviewImageSchema = z.object({
  body: z.file().mime([...LINK_PREVIEW_IMAGE_TYPES]),
  headers: z.object({
    "cache-control": z.string(),
    "content-disposition": z.string(),
    "content-security-policy": z.string(),
    "cross-origin-resource-policy": z.literal("same-origin"),
    "x-content-type-options": z.literal("nosniff"),
  }),
});

export const linkPreviews = {
  get: authed
    .errors(featureError)
    .route({
      description:
        "The page's title, description, site name, image and favicon, from its `og:*`, `twitter:*` and `<head>` tags. Fetched by the server (private networks refused) and cached; `image.url` and `icon` are paths on this API.",
      method: "GET",
      path: "/link-preview",
      summary: "Preview a link",
    })
    .input(linkPreviewInputSchema)
    .output(linkPreviewSchema),
  image: authed
    .errors(featureError)
    .route({
      description:
        "A preview's image or favicon, by the signed `src` a preview gave. Only addresses a preview produced are served (it's not a proxy); raster images under 2 MB, never SVG.",
      method: "GET",
      outputStructure: "detailed",
      path: "/link-preview/image",
      summary: "Get a link preview image",
    })
    .input(linkPreviewImageInputSchema)
    .output(linkPreviewImageSchema),
};
