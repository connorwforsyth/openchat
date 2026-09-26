import type {
  MessagePart,
  ToolOutput,
} from "@workspace/contract/schemas/message-parts";
import { err, ok, type Result } from "@workspace/shared/result";
import { z } from "zod";

import {
  asJson,
  cleanTitle,
  count,
  importedContentPart,
  importedFilePart,
  mediaType,
  modelRef,
  nonEmpty,
  reasoningPart,
  textPart,
  toolCallId,
  toolCallPart,
  toolName,
  toolResultPart,
} from "./parts";
import {
  type ConversationFailure,
  describeIssues,
  IMPORT_LIMITS,
  type ImportedConversation,
} from "./schema";
import { buildTree, type DraftMessage, msFromString } from "./tree";

// claude.ai's "Export data" archive holds `conversations.json`: an array of
// conversations, each with `chat_messages` in order. Each message has a
// `sender` (`human` | `assistant`), a plain `text` and, in newer exports,
// typed `content` blocks (`text`, `thinking`, `tool_use`, `tool_result`),
// plus `attachments` (with the text Claude extracted) and `files` (names
// only). There's no public spec: this follows exports observed in the wild
// and LibreChat's importer (MIT, see NOTICE). The fixture is synthetic.
//
// The export is linear (only the branch the user was on), so messages chain
// in order. If every message carries `parent_message_uuid` (some exports
// do), that tree is used instead. Attachment bytes aren't in the export;
// each becomes an `imported-file` record.

const blockSchema = z.looseObject({ type: z.string() });
const textBlockSchema = z.looseObject({
  citations: z
    .array(
      z.looseObject({
        details: z.looseObject({ url: z.string().nullish() }).nullish(),
        title: z.string().nullish(),
        url: z.string().nullish(),
      })
    )
    .nullish(),
  text: z.string(),
});
const thinkingBlockSchema = z.looseObject({ thinking: z.string() });
const toolUseBlockSchema = z.looseObject({
  id: z.string().nullish(),
  input: z.unknown(),
  name: z.string().nullish(),
});
const toolResultBlockSchema = z.looseObject({
  content: z.unknown(),
  is_error: z.boolean().nullish(),
  name: z.string().nullish(),
  tool_use_id: z.string().nullish(),
});

const claudeMessageSchema = z.looseObject({
  attachments: z
    .array(
      z.looseObject({
        extracted_content: z.string().nullish(),
        file_name: z.string().nullish(),
        file_size: z.number().nullish(),
        file_type: z.string().nullish(),
      })
    )
    .nullish(),
  content: z.array(blockSchema).nullish(),
  created_at: z.string().nullish(),
  files: z
    .array(
      z.looseObject({
        file_name: z.string().nullish(),
        file_uuid: z.string().nullish(),
      })
    )
    .nullish(),
  parent_message_uuid: z.string().nullish(),
  sender: z.string(),
  text: z.string().nullish(),
  uuid: z.string().nullish(),
});
type ClaudeMessage = z.infer<typeof claudeMessageSchema>;

export const claudeConversationSchema = z.looseObject({
  chat_messages: z.array(claudeMessageSchema),
  created_at: z.string().nullish(),
  current_leaf_message_uuid: z.string().nullish(),
  model: z.string().nullish(),
  name: z.string().nullish(),
  uuid: z.string().nullish(),
});

/** Whether `value` looks like a Claude conversation (for format detection). */
export const isClaudeConversation = (value: unknown): boolean =>
  typeof value === "object" &&
  value !== null &&
  "chat_messages" in value &&
  Array.isArray(value.chat_messages);

const ROLES: Partial<Record<string, "assistant" | "user">> = {
  assistant: "assistant",
  human: "user",
};

const urlSchema = z.url({ protocol: /^https?$/ });

/** Plain text from a tool result's content: a string, or text blocks. */
const resultText = (content: unknown): string => {
  if (typeof content === "string") {
    return content;
  }
  const blocks = z.array(z.unknown()).safeParse(content);
  return (blocks.success ? blocks.data : [])
    .map((block) => textBlockSchema.safeParse(block).data?.text ?? "")
    .filter(Boolean)
    .join("\n");
};

interface OpenCall {
  readonly id: string;
  readonly name: string;
}

const textBlock = (block: unknown): MessagePart[] | undefined => {
  const parsed = textBlockSchema.safeParse(block);
  if (!parsed.success) {
    return;
  }
  const sources = (parsed.data.citations ?? []).flatMap(
    (citation): MessagePart[] => {
      const url = urlSchema.safeParse(citation.details?.url ?? citation.url);
      if (!url.success) {
        return [];
      }
      const title = nonEmpty(citation.title);
      return [
        {
          id: "source",
          source: title
            ? { kind: "url", title, url: url.data }
            : { kind: "url", url: url.data },
          type: "source",
        },
      ];
    }
  );
  return [
    ...(parsed.data.text.trim() ? [textPart(parsed.data.text)] : []),
    ...sources,
  ];
};

const thinkingBlock = (block: unknown): MessagePart[] | undefined => {
  const parsed = thinkingBlockSchema.safeParse(block);
  if (!parsed.success) {
    return;
  }
  return parsed.data.thinking.trim()
    ? [reasoningPart(parsed.data.thinking)]
    : [];
};

const toolUseBlock = (
  block: unknown,
  fallbackId: string,
  openCalls: OpenCall[]
): MessagePart[] | undefined => {
  const parsed = toolUseBlockSchema.safeParse(block);
  if (!parsed.success) {
    return;
  }
  const call = {
    id: toolCallId(parsed.data.id, fallbackId),
    name: toolName(parsed.data.name),
  };
  openCalls.push(call);
  return [
    toolCallPart({
      ...call,
      input: asJson(parsed.data.input ?? {}),
      providerExecuted: true,
    }),
  ];
};

/**
 * A result, matched to its call by `tool_use_id`, or else to the latest
 * unanswered call of the same name (older exports carry names, not ids).
 */
const toolResultBlock = (
  block: unknown,
  openCalls: OpenCall[]
): MessagePart[] | undefined => {
  const parsed = toolResultBlockSchema.safeParse(block);
  if (!parsed.success) {
    return;
  }
  const name = toolName(parsed.data.name);
  const wanted = parsed.data.tool_use_id;
  const index = openCalls
    .map((open) => (wanted ? open.id === wanted : open.name === name))
    .lastIndexOf(true);
  const call = openCalls[index];
  if (!call) {
    return;
  }
  openCalls.splice(index, 1);
  const output: ToolOutput = parsed.data.is_error
    ? { message: resultText(parsed.data.content), status: "error" }
    : { status: "success", value: asJson(parsed.data.content ?? null) };
  return [toolResultPart({ ...call, output })];
};

/** Sources once per URL, numbered in order, so text can refer to them. */
const numberSources = (parts: readonly MessagePart[]): MessagePart[] => {
  const seen = new Set<string>();
  return parts.flatMap((part): MessagePart[] => {
    if (part.type !== "source" || part.source.kind !== "url") {
      return [part];
    }
    if (seen.has(part.source.url)) {
      return [];
    }
    seen.add(part.source.url);
    return [{ ...part, id: `source-${seen.size}` }];
  });
};

/** Content blocks as parts; a block we can't map is kept as `imported-content`. */
const blockParts = (
  message: ClaudeMessage,
  messageId: string
): MessagePart[] => {
  const openCalls: OpenCall[] = [];
  const parts = (message.content ?? []).flatMap((block, i) => {
    let mapped: MessagePart[] | undefined;
    switch (block.type) {
      case "text":
        mapped = textBlock(block);
        break;
      case "thinking":
        mapped = thinkingBlock(block);
        break;
      case "tool_use":
        mapped = toolUseBlock(block, `${messageId}-${i}`, openCalls);
        break;
      case "tool_result":
        mapped = toolResultBlock(block, openCalls);
        break;
      default:
        mapped = undefined;
    }
    return mapped ?? [importedContentPart("claude", block.type, block)];
  });
  return numberSources(parts);
};

const fileParts = (message: ClaudeMessage): MessagePart[] => [
  ...(message.attachments ?? []).map((attachment) =>
    importedFilePart({
      extractedText: nonEmpty(attachment.extracted_content),
      filename: nonEmpty(attachment.file_name)?.slice(0, 512),
      mediaType: mediaType(attachment.file_type),
      origin: "claude",
      sizeBytes: count(attachment.file_size),
    })
  ),
  ...(message.files ?? []).map((file) =>
    importedFilePart({
      filename: nonEmpty(file.file_name)?.slice(0, 512),
      origin: "claude",
      ref: nonEmpty(file.file_uuid)?.slice(0, 2048),
    })
  ),
];

/**
 * One conversation from `conversations.json`. `index` is its position in the
 * export (for the failure report and for ids an old export leaves out);
 * `now` dates a conversation the export didn't.
 */
export const parseClaudeConversation = (
  raw: unknown,
  index = 0,
  now: () => Date = () => new Date()
): Result<ImportedConversation, ConversationFailure> => {
  const parsed = claudeConversationSchema.safeParse(raw);
  if (!parsed.success) {
    return err({
      detail: describeIssues(parsed.error),
      index,
      reason: "invalid_shape",
      sourceId: null,
    });
  }
  const conversation = parsed.data;
  const sourceId = conversation.uuid ?? null;
  const messages = conversation.chat_messages;
  if (messages.length > IMPORT_LIMITS.maxMessagesPerConversation) {
    return err({
      detail: `${messages.length} messages`,
      index,
      reason: "too_large",
      sourceId,
    });
  }
  const model = modelRef("anthropic", conversation.model);
  const ids = messages.map((message, i) => message.uuid ?? `message-${i}`);
  const tree = messages.every((message) => message.parent_message_uuid);
  const drafts = messages.map((message, i): DraftMessage => {
    const id = ids[i] as string;
    const parentSourceId = tree
      ? (message.parent_message_uuid ?? null)
      : (ids[i - 1] ?? null);
    const role = ROLES[message.sender] ?? null;
    const content = blockParts(message, id);
    const parts = [
      ...(content.length > 0 || !message.text?.trim()
        ? content
        : [textPart(message.text)]),
      ...fileParts(message),
    ];
    return {
      body:
        role && parts.length > 0
          ? {
              createdAtMs: msFromString(message.created_at),
              model: role === "assistant" ? model : null,
              parts,
              role,
              status: "complete",
            }
          : null,
      parentSourceId,
      sourceId: id,
    };
  });
  const createdMs =
    msFromString(conversation.created_at) ??
    msFromString(messages[0]?.created_at) ??
    now().getTime();
  const built = buildTree(drafts, createdMs);
  if (built.messages.length === 0) {
    return err({ index, reason: "empty", sourceId });
  }
  return ok({
    activeLeafSourceId: built.resolve(
      conversation.current_leaf_message_uuid ?? ids.at(-1)
    ),
    createdAt: new Date(createdMs).toISOString(),
    messages: [...built.messages],
    source: "claude",
    sourceId,
    title: cleanTitle(conversation.name),
  });
};
