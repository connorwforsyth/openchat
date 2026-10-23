import { defineTool } from "@workspace/ai/tools/registry/define";
import { sandboxPathSchema } from "@workspace/contract/schemas/sandbox";
import { z } from "zod";

import { WORKDIR } from "../../paths";
import {
  decodeText,
  failure,
  readBytes,
  type SandboxToolContext,
  toolErrorSchema,
} from "../workspace";

// `read` only reads files inside `/work` (D7, 074), by the same rule as the
// Files panel's routes; anywhere else is an error the model can correct.
// An image comes back as a small `image` result, and the model is shown the
// picture itself with it (`ctx.show`), never stored in the chat. Whether the
// model can see it is the model's business: `withToolImages` turns it into
// a note for one that can't.

/** Largest file `read` returns whole; bigger ones need `offset`/`limit`. */
const MAX_READ_CHARS = 200_000;

/** Largest image `read` shows the model. */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export const readInputSchema = z.object({
  limit: z.int().min(1).max(10_000).optional().describe("Lines to return"),
  offset: z.int().min(1).optional().describe("1-based line to start at"),
  path: sandboxPathSchema,
});

const imageMediaTypeSchema = z.enum([
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
]);
type ImageMediaType = z.infer<typeof imageMediaTypeSchema>;

export const readOutputSchema = z.discriminatedUnion("status", [
  z.object({
    content: z.string(),
    path: z.string(),
    status: z.literal("read"),
    totalLines: z.int().min(0),
    truncated: z.boolean(),
  }),
  z.object({
    mediaType: imageMediaTypeSchema,
    path: z.string(),
    /** In bytes. */
    size: z.int().min(0),
    status: z.literal("image"),
  }),
  toolErrorSchema,
]);
export type ReadOutput = z.infer<typeof readOutputSchema>;

const startsWith = (bytes: Uint8Array, at: number, ascii: string) =>
  [...ascii].every((char, i) => bytes[at + i] === char.charCodeAt(0));

/** The image format `bytes` are, by their magic number; `null` for anything else. Pure. */
export const imageMediaTypeOf = (bytes: Uint8Array): ImageMediaType | null => {
  if (startsWith(bytes, 0, "\x89PNG\r\n\x1a\n")) {
    return "image/png";
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (startsWith(bytes, 0, "GIF8")) {
    return "image/gif";
  }
  if (startsWith(bytes, 0, "RIFF") && startsWith(bytes, 8, "WEBP")) {
    return "image/webp";
  }
  return null;
};

const sliceLines = (
  text: string,
  offset: number | undefined,
  limit: number | undefined
) => {
  const lines = text.split("\n");
  const start = (offset ?? 1) - 1;
  const end = limit === undefined ? lines.length : start + limit;
  return { content: lines.slice(start, end).join("\n"), total: lines.length };
};

const megabytes = (bytes: number) => (bytes / (1024 * 1024)).toFixed(1);

/** What the model reads for a result. Text reads stay the JSON they always were. */
export const readModelText = (output: ReadOutput): string =>
  output.status === "image"
    ? `${output.path} is an image (${output.mediaType}, ${output.size} bytes).`
    : JSON.stringify(output);

export const read = defineTool({
  approval: "auto",
  capability: "sandbox",
  description: `Read a file from the workspace (${WORKDIR}, the user's Files panel): text, optionally a range of lines, or an image (PNG, JPEG, GIF, WebP), which you are shown. Paths must be inside ${WORKDIR}; relative paths are relative to it.`,
  execute: async (
    { limit, offset, path },
    { show, workspace }: SandboxToolContext
  ): Promise<ReadOutput> => {
    const file = await readBytes(workspace.sandbox, path, {
      missingIsEmpty: false,
    });
    if (!file.ok) {
      return failure(file.error);
    }
    const { bytes } = file.value;
    const mediaType = imageMediaTypeOf(bytes);
    if (mediaType) {
      if (bytes.byteLength > MAX_IMAGE_BYTES) {
        return failure(
          `${path} is a ${megabytes(bytes.byteLength)} MB image; read shows images up to ${megabytes(MAX_IMAGE_BYTES)} MB.`
        );
      }
      show?.({
        data: Buffer.from(
          bytes.buffer,
          bytes.byteOffset,
          bytes.byteLength
        ).toString("base64"),
        mediaType,
      });
      return { mediaType, path, size: bytes.byteLength, status: "image" };
    }
    const text = decodeText(path, bytes);
    if (!text.ok) {
      return failure(text.error);
    }
    const { content, total } = sliceLines(text.value, offset, limit);
    const truncated = content.length > MAX_READ_CHARS;
    return {
      content: truncated ? content.slice(0, MAX_READ_CHARS) : content,
      path,
      status: "read",
      totalLines: total,
      truncated,
    };
  },
  input: readInputSchema,
  modelText: readModelText,
  name: "read",
  output: readOutputSchema,
});
