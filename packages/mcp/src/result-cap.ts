import { capText } from "@workspace/shared/utils";
import { z } from "zod";

// An MCP tool's result goes to the model, into the run's stream (and every
// replay of it) and into the stored message, and a server can answer with
// megabytes. So it's cut here, once, the way sandbox output is: the head and
// the tail of each text, with a note in between the model can read saying
// how much went. Images and other binary parts pass through untouched; no
// limit exists for them yet.

/**
 * For a whole result, across its texts and structured content: about 25k
 * tokens, what other MCP clients allow by default, so one call can't eat a
 * small model's context.
 */
export const MAX_TOOL_RESULT_CHARS = 100 * 1024;

// Loose on purpose: only the fields that carry text are read; everything
// else in the result, known or not, is passed on as it came.
const textPartSchema = z.looseObject({
  text: z.string(),
  type: z.literal("text"),
});
const textResourcePartSchema = z.looseObject({
  resource: z.looseObject({ text: z.string() }),
  type: z.literal("resource"),
});
const resultWithContentSchema = z.looseObject({
  content: z.array(z.unknown()),
  structuredContent: z.unknown().optional(),
});

type ResultWithContent = z.infer<typeof resultWithContentSchema>;

/**
 * Shares `max` among items of the given lengths: an item that fits in an even
 * share keeps all of it, and what it leaves over goes to the bigger ones.
 */
export const allot = (
  lengths: readonly number[],
  max: number
): readonly number[] => {
  const order = lengths
    .map((length, index) => ({ index, length }))
    .sort((a, b) => a.length - b.length);
  const shares = new Array<number>(lengths.length).fill(0);
  let remaining = Math.max(max, 0);
  for (const [position, { index, length }] of order.entries()) {
    const even = Math.floor(remaining / (order.length - position));
    const share = Math.min(length, even);
    shares[index] = share;
    remaining -= share;
  }
  return shares;
};

/** The text a part carries, or null for images and anything else. */
const textOf = (part: unknown): string | null => {
  const text = textPartSchema.safeParse(part);
  if (text.success) {
    return text.data.text;
  }
  const resource = textResourcePartSchema.safeParse(part);
  return resource.success ? resource.data.resource.text : null;
};

const withText = (part: unknown, text: string): unknown => {
  const resource = textResourcePartSchema.safeParse(part);
  if (resource.success) {
    return {
      ...resource.data,
      resource: { ...resource.data.resource, text },
    };
  }
  const plain = textPartSchema.safeParse(part);
  return plain.success ? { ...plain.data, text } : part;
};

/** The result cut to `max`, or null when it already fits. */
const capContent = (
  result: ResultWithContent,
  max: number
): ResultWithContent | null => {
  const { structuredContent, ...rest } = result;
  const structured =
    structuredContent === undefined
      ? null
      : (JSON.stringify(structuredContent) ?? null);
  const texts = result.content.map(textOf);
  const lengths = [
    ...texts.map((text) => text?.length ?? 0),
    structured?.length ?? 0,
  ];
  const total = lengths.reduce((sum, length) => sum + length, 0);
  if (total <= max) {
    return null;
  }
  const shares = allot(lengths, max);
  const content = result.content.map((part, index) => {
    const text = texts[index];
    const share = shares[index] ?? 0;
    return text === null || text === undefined || text.length <= share
      ? part
      : withText(part, capText(text, share).text);
  });
  const structuredShare = shares.at(-1) ?? 0;
  if (structured === null || structured.length <= structuredShare) {
    return {
      ...rest,
      content,
      ...(structuredContent === undefined ? {} : { structuredContent }),
    };
  }
  // Structured content can't be cut and stay valid, so what's left of it
  // travels as text, where the model can read it.
  return {
    ...rest,
    content: [
      ...content,
      { text: capText(structured, structuredShare).text, type: "text" },
    ],
  };
};

/**
 * Caps an MCP tool result at about `max` characters of text, keeping its
 * shape: each text part (and a text resource) keeps its head and tail with a
 * note of what was omitted, and structured content too big for its share
 * becomes a cut text part. A result without `content` (the old `toolResult`
 * form) is cut as JSON into a single text part. Small results come back as
 * they were.
 */
export const capToolResult = (
  result: unknown,
  max = MAX_TOOL_RESULT_CHARS
): unknown => {
  const withContent = resultWithContentSchema.safeParse(result);
  if (withContent.success) {
    return capContent(withContent.data, max) ?? result;
  }
  const json = JSON.stringify(result) ?? "";
  if (json.length <= max) {
    return result;
  }
  const isError =
    typeof result === "object" &&
    result !== null &&
    "isError" in result &&
    result.isError === true;
  return {
    content: [{ text: capText(json, max).text, type: "text" }],
    ...(isError ? { isError } : {}),
  };
};
