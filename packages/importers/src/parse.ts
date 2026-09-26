import { err, type Result } from "@workspace/shared/result";

import { isChatGptConversation, parseChatGptConversation } from "./chatgpt";
import { isClaudeConversation, parseClaudeConversation } from "./claude";
import { isLibreChatExport, parseLibreChatExport } from "./librechat";
import type {
  ConversationFailure,
  ImportedConversation,
  ImportSource,
} from "./schema";
import { type SplitOptions, splitTopLevel } from "./stream";

// Entry points: detect the format of each conversation and parse it. Both
// yield one `Result` per conversation, so a bad one is reported and the rest
// import; `persistImport` takes that sequence as it comes.

export type ParsedConversation = Result<
  ImportedConversation,
  ConversationFailure
>;

/** Which export a value is a conversation from, if any. */
export const detectFormat = (value: unknown): ImportSource | null => {
  if (isChatGptConversation(value)) {
    return "chatgpt";
  }
  if (isClaudeConversation(value)) {
    return "claude";
  }
  if (isLibreChatExport(value)) {
    return "librechat";
  }
  return null;
};

export interface ParseOptions {
  /** Dates a conversation its export didn't. */
  readonly now?: () => Date;
}

/** One conversation of any supported format. */
export const parseConversation = (
  value: unknown,
  index = 0,
  { now = () => new Date() }: ParseOptions = {}
): ParsedConversation => {
  switch (detectFormat(value)) {
    case "chatgpt":
      return parseChatGptConversation(value, index, now);
    case "claude":
      return parseClaudeConversation(value, index, now);
    case "librechat":
      return parseLibreChatExport(value, index, now);
    case null:
      return err({ index, reason: "unknown_format", sourceId: null });
    default:
      return err({ index, reason: "unknown_format", sourceId: null });
  }
};

/**
 * An export already in memory: a ChatGPT or Claude `conversations.json`
 * array, or a LibreChat export object. Anything else is one `unknown_format`
 * failure.
 */
export const parseExport = (
  json: unknown,
  options: ParseOptions = {}
): ParsedConversation[] => {
  if (Array.isArray(json)) {
    return json.map((value, i) => parseConversation(value, i, options));
  }
  return [parseConversation(json, 0, options)];
};

/**
 * An export read in chunks (a file or upload stream, UTF-8), parsed one
 * conversation at a time so memory is bounded by the largest conversation.
 * If the first value isn't a conversation we recognise, it stops there:
 * exports are all one format, so the rest won't be either.
 */
export async function* parseExportStream(
  source: AsyncIterable<Uint8Array | string> | Iterable<Uint8Array | string>,
  options: ParseOptions & SplitOptions = {}
): AsyncGenerator<ParsedConversation> {
  for await (const item of splitTopLevel(source, options)) {
    switch (item.type) {
      case "value": {
        const parsed = parseConversation(item.value, item.index, options);
        yield parsed;
        if (
          !parsed.ok &&
          parsed.error.reason === "unknown_format" &&
          item.index === 0
        ) {
          return;
        }
        break;
      }
      case "skipped":
        yield err({ index: item.index, reason: item.reason, sourceId: null });
        break;
      case "fatal":
        yield err({
          detail: item.detail,
          index: item.index,
          reason: "invalid_json",
          sourceId: null,
        });
        return;
      default:
        return item satisfies never;
    }
  }
}
