import { isParseable } from "@workspace/ai/rag/parse";
import { z } from "zod";

// Upload validation (PLAN.md §8 RAG step 1): which files we accept, and
// under what content type we store them. Declared types are checked
// against the bytes for binary formats, since a browser only guesses from
// the extension and a client can claim anything.

/** Images a chat can attach (shown to vision models, not indexed). */
const IMAGE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
]);

/** Leading bytes each binary type must start with. */
const MAGIC: Readonly<Record<string, readonly (readonly (number | null)[])[]>> =
  {
    "application/pdf": [[0x25, 0x50, 0x44, 0x46, 0x2d]],
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": [
      [0x50, 0x4b, 0x03, 0x04],
    ],
    "image/gif": [[0x47, 0x49, 0x46, 0x38]],
    "image/jpeg": [[0xff, 0xd8, 0xff]],
    "image/png": [[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]],
    // RIFF....WEBP
    "image/webp": [
      [0x52, 0x49, 0x46, 0x46, null, null, null, null, 0x57, 0x45, 0x42, 0x50],
    ],
  };

const EXTENSION_TYPES: Readonly<Record<string, string>> = {
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  gif: "image/gif",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  md: "text/markdown",
  pdf: "application/pdf",
  png: "image/png",
  txt: "text/plain",
  webp: "image/webp",
};

const TEXT = "text/plain; charset=utf-8";

const baseType = (mediaType: string) =>
  mediaType.split(";")[0]?.trim().toLowerCase() ?? "";

const matches = (bytes: Uint8Array, signature: readonly (number | null)[]) =>
  signature.every((byte, index) => byte === null || bytes[index] === byte);

export const uploadCheckSchema = z.discriminatedUnion("ok", [
  z.object({
    /** Whether ingestion can read text from it. */
    indexable: z.boolean(),
    /** The type to record on the file. */
    mediaType: z.string(),
    ok: z.literal(true),
    /** The type to store (and so serve) the bytes as. */
    storedType: z.string(),
  }),
  z.object({ message: z.string(), ok: z.literal(false) }),
]);
export type UploadCheck = z.infer<typeof uploadCheckSchema>;

/**
 * Accepts images, PDFs, Word documents and anything textual; checks size
 * and, for binary types, the leading bytes.
 */
export const checkUpload = ({
  bytes,
  maxBytes,
  mediaType: declared,
  name,
}: {
  readonly bytes: Uint8Array;
  readonly maxBytes: number;
  readonly mediaType: string;
  readonly name: string;
}): UploadCheck => {
  if (bytes.length === 0) {
    return { message: "The file is empty.", ok: false };
  }
  if (bytes.length > maxBytes) {
    return {
      message: `The file is larger than the ${Math.floor(maxBytes / 1024 / 1024)} MB limit.`,
      ok: false,
    };
  }
  const extension = name.split(".").at(-1)?.toLowerCase() ?? "";
  const type =
    baseType(declared) && baseType(declared) !== "application/octet-stream"
      ? baseType(declared)
      : (EXTENSION_TYPES[extension] ?? baseType(declared));
  const indexable = isParseable(type, name);
  if (!(IMAGE_TYPES.has(type) || indexable)) {
    return {
      message:
        "This kind of file can't be uploaded. Try a PDF, Word document, image or text file.",
      ok: false,
    };
  }
  const signatures = MAGIC[type];
  if (
    signatures &&
    !signatures.some((signature) => matches(bytes, signature))
  ) {
    return {
      message: "The file's contents don't match its type.",
      ok: false,
    };
  }
  return {
    indexable,
    mediaType: type,
    ok: true,
    // Text of any kind (HTML, SVG and script included) is stored as plain
    // text, so a signed URL can never serve something a browser would run.
    storedType: signatures || IMAGE_TYPES.has(type) ? type : TEXT,
  };
};
