import type { Message } from "@workspace/contract/schemas/messages";
import type { RunError } from "@workspace/contract/schemas/runs";
import { type AsyncResult, err, ok } from "@workspace/shared/result";
import { generateText, type LanguageModel } from "ai";

import { toRunError } from "../errors/run-error";
import { type TraceContext, tracedCall } from "../telemetry/trace-context";

// Conversation titles (D4 jobs): the title job (ticket 014) passes the first
// exchange and a cheap model. Only text is sent: titles don't need files, and
// the less of a chat that leaves for a title, the better.

const INSTRUCTIONS = [
  "Write a short title for this conversation: at most six words, in the language the user wrote in.",
  "Reply with the title only: no quotes, no trailing punctuation, no prefix like 'Title:'.",
].join(" ");

const MAX_INPUT_CHARS = 4000;
const MAX_TITLE_CHARS = 80;
const TITLE_PREFIX = /^(?:title|titel|titre|título)\s*:\s*/i;
const WRAPPING = /^["'“”‘’«»*_#`\s]+|["'“”‘’«»*_#`\s]+$/g;
const TRAILING_PUNCTUATION = /[.!?。:;,]+$/u;
const WHITESPACE = /\s+/g;

/** Tidies what a model returns into a title, or `null` if nothing usable is left. Pure. */
export const cleanTitle = (raw: string): string | null => {
  const firstLine = raw.trim().split("\n")[0] ?? "";
  const title = firstLine
    .replace(TITLE_PREFIX, "")
    .replace(WRAPPING, "")
    .replace(TRAILING_PUNCTUATION, "")
    .replace(WHITESPACE, " ")
    .trim();
  if (!title) {
    return null;
  }
  return title.length > MAX_TITLE_CHARS
    ? `${title.slice(0, MAX_TITLE_CHARS - 1).trimEnd()}…`
    : title;
};

/** The text of the conversation's first turns, trimmed for a title prompt. Pure. */
export const titleInput = (
  messages: readonly Pick<Message, "parts" | "role">[]
): string =>
  messages
    .filter((message) => message.role !== "system")
    .map((message) => {
      const text = message.parts
        .flatMap((part) => (part.type === "text" ? [part.text] : []))
        .join("\n")
        .trim();
      return text ? `${message.role}: ${text}` : "";
    })
    .filter(Boolean)
    .join("\n\n")
    .slice(0, MAX_INPUT_CHARS);

// Only before a space or the end, so `Next.js` and `v1.2` stay whole. CJK
// full stops take no space after them.
const SENTENCE_END = /[.!?](?=\s|$)|[。\n]/u;
const FALLBACK_WORDS = 8;

/**
 * A title from the user's first message alone, for when no model can write
 * one: its first sentence, cut to a few words. `null` with no text. Pure.
 */
export const fallbackTitle = (
  messages: readonly Pick<Message, "parts" | "role">[]
): string | null => {
  const first = messages
    .filter((message) => message.role === "user")
    .flatMap((message) =>
      message.parts.flatMap((part) => (part.type === "text" ? [part.text] : []))
    )
    .find((text) => text.trim());
  if (!first) {
    return null;
  }
  const sentence = first.trim().split(SENTENCE_END)[0] ?? "";
  const words = sentence.split(WHITESPACE).filter(Boolean);
  const cut = words.slice(0, FALLBACK_WORDS).join(" ");
  return cleanTitle(words.length > FALLBACK_WORDS ? `${cut}…` : cut);
};

export const generateTitle = async (
  messages: readonly Pick<Message, "parts" | "role">[],
  model: LanguageModel,
  {
    signal,
    trace,
  }: { readonly signal?: AbortSignal; readonly trace?: TraceContext } = {}
): AsyncResult<string, RunError> => {
  const input = titleInput(messages);
  if (!input) {
    return err({
      code: "internal",
      message: "There's no text to title yet.",
      retryable: false,
    });
  }
  try {
    const { text } = await generateText({
      abortSignal: signal,
      instructions: INSTRUCTIONS,
      maxOutputTokens: 32,
      model,
      prompt: input,
      reasoning: "none",
      temperature: 0.3,
      ...tracedCall(trace),
    });
    const title = cleanTitle(text);
    return title
      ? ok(title)
      : err({
          code: "provider_error",
          message: "The model didn't return a title.",
          retryable: true,
        });
  } catch (cause) {
    return err(toRunError(cause));
  }
};
