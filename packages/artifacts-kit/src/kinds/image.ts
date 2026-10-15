import { z } from "zod";

import { matches, sizeLimit } from "../checks";
import { defineArtifactKind } from "../define";

// A picture `generate_image` made (138). A version is the image itself as a
// `data:` URL, so the Artifacts page and anyone it's shared with see it
// without the chat's workspace, where the same picture is also a file. Only
// the tool writes one: `create_artifact` and the `:::artifact` directive
// don't offer the kind, and no operation replaces it by hand.

/** About 12 MB of image: past what an image model returns at its largest. */
export const IMAGE_MAX_CHARS = 16_000_000;

/** The image types a version may hold, by media type. */
export const IMAGE_MEDIA_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
] as const;

const DATA_URL = /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/;

/** A version's content: one image as a `data:` URL. */
export const imageDataUrl = (mediaType: string, base64: string): string =>
  `data:${mediaType};base64,${base64}`;

export const imageKind = defineArtifactKind<string>({
  capabilities: {
    aiCalls: false,
    annotate: false,
    present: false,
    share: false,
  },
  checks: [
    sizeLimit({ chars: IMAGE_MAX_CHARS }),
    matches(
      DATA_URL,
      "content isn't a PNG, JPEG or WebP image as a base64 data: URL"
    ),
  ],
  content: z.string(),
  diff: "text",
  editor: "none",
  export: [{ extension: "png", format: "file" }],
  icon: "ImageIcon",
  instructions: "",
  kind: "image",
  label: "Image",
  operations: {},
  render: { panel: "image", runtime: null },
  thumbnail: "none",
});
