import type { LINK_PREVIEW_IMAGE_TYPES } from "@workspace/contract/schemas/link-preview";

// What an image really is, from its first bytes (101). The image route
// serves the sniffed type, never the remote's claim, so a page can't label
// HTML or SVG as `image/png` and have it rendered.

export type PreviewImageType = (typeof LINK_PREVIEW_IMAGE_TYPES)[number];

const startsWith = (bytes: Uint8Array, signature: readonly number[], at = 0) =>
  signature.every((byte, index) => bytes[at + index] === byte);

const ascii = (text: string) => [...text].map((char) => char.charCodeAt(0));

export const sniffImageType = (bytes: Uint8Array): PreviewImageType | null => {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return "image/png";
  }
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) {
    return "image/jpeg";
  }
  if (
    startsWith(bytes, ascii("GIF87a")) ||
    startsWith(bytes, ascii("GIF89a"))
  ) {
    return "image/gif";
  }
  if (startsWith(bytes, ascii("RIFF")) && startsWith(bytes, ascii("WEBP"), 8)) {
    return "image/webp";
  }
  if (
    startsWith(bytes, ascii("ftyp"), 4) &&
    (startsWith(bytes, ascii("avif"), 8) || startsWith(bytes, ascii("avis"), 8))
  ) {
    return "image/avif";
  }
  if (startsWith(bytes, [0x00, 0x00, 0x01, 0x00])) {
    return "image/x-icon";
  }
  if (startsWith(bytes, ascii("BM"))) {
    return "image/bmp";
  }
  return null;
};
