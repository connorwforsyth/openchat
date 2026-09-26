import type { MessagePart } from "@workspace/contract/schemas/message-parts";
import type { MessageStatus } from "@workspace/contract/schemas/messages";
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
import {
  buildTree,
  type DraftMessage,
  mergeAssistantChains,
  validMs,
} from "./tree";

// ChatGPT's "Export data" archive holds `conversations.json`: an array of
// conversations, each a `mapping` of node id -> { message, parent, children }
// and a `current_node` (the leaf the user was last on). Every edit and
// regeneration is a sibling in that tree, and all of it is imported, not just
// the path to `current_node`. Ported from LibreChat's `importers.js` and
// `conversations/chatgpt.ts` (MIT, see NOTICE), with these choices:
// - system prompts, hidden nodes (`is_visually_hidden_from_conversation`),
//   custom-instruction context and reasoning recaps are passed over; their
//   children attach to the nearest kept ancestor;
// - `thoughts` become a reasoning part, folded into the answer that follows;
// - an assistant node addressed to a tool (`recipient` other than `all`) is a
//   tool call, and the tool's reply is its result; a tool turn's nodes fold
//   into one assistant message, as our own runs store them;
// - webpage citations become source parts, and their markers become
//   Markdown links, as LibreChat does.
//
// Every field is optional or loose: the format is undocumented and has
// changed many times. Unknown content types are kept as `imported-content`.

const looseRecord = z.record(z.string(), z.unknown());

const chatGptMessageSchema = z.looseObject({
  author: z.looseObject({
    name: z.string().nullish(),
    role: z.string(),
  }),
  content: z.looseObject({ content_type: z.string() }),
  create_time: z.number().nullish(),
  id: z.string().nullish(),
  metadata: looseRecord.nullish(),
  recipient: z.string().nullish(),
  status: z.string().nullish(),
});
type ChatGptMessage = z.infer<typeof chatGptMessageSchema>;

const chatGptNodeSchema = z.looseObject({
  children: z.array(z.string()).nullish(),
  message: chatGptMessageSchema.nullish(),
  parent: z.string().nullish(),
});
type ChatGptNode = z.infer<typeof chatGptNodeSchema>;

export const chatGptConversationSchema = z.looseObject({
  conversation_id: z.string().nullish(),
  create_time: z.number().nullish(),
  current_node: z.string().nullish(),
  default_model_slug: z.string().nullish(),
  id: z.string().nullish(),
  mapping: z.record(z.string(), chatGptNodeSchema),
  title: z.string().nullish(),
});
type ChatGptConversation = z.infer<typeof chatGptConversationSchema>;

/** Whether `value` looks like a ChatGPT conversation (for format detection). */
export const isChatGptConversation = (value: unknown): boolean =>
  typeof value === "object" &&
  value !== null &&
  "mapping" in value &&
  typeof value.mapping === "object";

const PASSED_OVER_CONTENT = new Set([
  "reasoning_recap",
  "user_editable_context",
  "model_editable_context",
]);

const textContentSchema = z.object({ parts: z.array(z.unknown()) });
const codeContentSchema = z.object({
  language: z.string().nullish(),
  text: z.string(),
});
const thoughtsContentSchema = z.object({
  thoughts: z.array(
    z.looseObject({
      content: z.string().nullish(),
      summary: z.string().nullish(),
    })
  ),
});
const assetPointerSchema = z.looseObject({
  asset_pointer: z.string(),
  content_type: z.literal("image_asset_pointer"),
  height: z.number().nullish(),
  size_bytes: z.number().nullish(),
  width: z.number().nullish(),
});
const transcriptionSchema = z.looseObject({
  content_type: z.literal("audio_transcription"),
  text: z.string(),
});
const attachmentSchema = z.looseObject({
  id: z.string().nullish(),
  mime_type: z.string().nullish(),
  name: z.string().nullish(),
  size: z.number().nullish(),
});
const citationSchema = z.looseObject({
  end_ix: z.int(),
  metadata: z
    .looseObject({
      title: z.string().nullish(),
      type: z.string().nullish(),
      url: z.string().nullish(),
    })
    .nullish(),
  start_ix: z.int(),
});
const contentReferenceSchema = z.looseObject({
  alt: z.string().nullish(),
  end_idx: z.int().nullish(),
  items: z
    .array(
      z.looseObject({ title: z.string().nullish(), url: z.string().nullish() })
    )
    .nullish(),
  matched_text: z.string().nullish(),
  start_idx: z.int().nullish(),
});

const urlSchema = z.url({ protocol: /^https?$/ });

interface Span {
  readonly end: number;
  readonly replacement: string;
  readonly start: number;
}

/**
 * Replaces spans from the end backward, so earlier offsets stay valid. A span
 * overlapping one already applied is left out (LibreChat's
 * `linkChatGptCitations`).
 */
const replaceSpans = (text: string, spans: readonly Span[]): string => {
  const valid = spans
    .filter(
      (span) =>
        span.start >= 0 && span.start < span.end && span.start < text.length
    )
    .sort((a, b) => b.start - a.start);
  const pieces: string[] = [];
  let boundary = text.length;
  for (const span of valid) {
    const end = Math.min(span.end, text.length);
    if (end > boundary) {
      continue;
    }
    pieces.push(text.slice(end, boundary), span.replacement);
    boundary = span.start;
  }
  pieces.push(text.slice(0, boundary));
  return pieces.reverse().join("");
};

interface Source {
  readonly title?: string;
  readonly url: string;
}

interface Linked {
  readonly sources: readonly Source[];
  readonly text: string;
}

const listOf = (value: unknown): readonly unknown[] =>
  Array.isArray(value) ? value : [];

const toSource = (url: unknown, title: unknown): Source[] => {
  const parsed = urlSchema.safeParse(url);
  if (!parsed.success) {
    return [];
  }
  const name = nonEmpty(title);
  return [name ? { title: name, url: parsed.data } : { url: parsed.data }];
};

/** `metadata.citations` (older exports): each marker becomes a Markdown link. */
const citationLinks = (metadata: Record<string, unknown>) =>
  listOf(metadata.citations).flatMap((raw) => {
    const citation = citationSchema.safeParse(raw);
    const meta = citation.data?.metadata;
    if (!(citation.success && meta?.type === "webpage" && meta.url)) {
      return [];
    }
    return [
      {
        sources: toSource(meta.url, meta.title),
        span: {
          end: citation.data.end_ix,
          replacement: ` ([${meta.title ?? meta.url}](${meta.url}))`,
          start: citation.data.start_ix,
        },
      },
    ];
  });

/**
 * `metadata.content_references` (newer exports): the private-use marker is
 * swapped for the export's own rendering (`alt`), or dropped.
 */
const referenceLinks = (text: string, metadata: Record<string, unknown>) =>
  listOf(metadata.content_references).flatMap((raw) => {
    const reference = contentReferenceSchema.safeParse(raw);
    if (!reference.success) {
      return [];
    }
    const { alt, end_idx, items, matched_text, start_idx } = reference.data;
    const sources = (items ?? []).flatMap((item) =>
      toSource(item.url, item.title)
    );
    const matches =
      typeof start_idx === "number" &&
      typeof end_idx === "number" &&
      Boolean(matched_text) &&
      text.slice(start_idx, end_idx) === matched_text;
    return [
      {
        sources,
        span: matches
          ? { end: end_idx, replacement: alt ?? "", start: start_idx }
          : undefined,
      },
    ];
  });

/**
 * Webpage citations in an assistant's text: markers become Markdown links
 * (as LibreChat does) and each page becomes a source, once per URL.
 */
const linkCitations = (
  text: string,
  metadata: Record<string, unknown> | null | undefined
): Linked => {
  if (!metadata) {
    return { sources: [], text };
  }
  const links = [...citationLinks(metadata), ...referenceLinks(text, metadata)];
  const sources = new Map<string, Source>();
  for (const source of links.flatMap((link) => link.sources)) {
    if (!sources.has(source.url)) {
      sources.set(source.url, source);
    }
  }
  const spans = links.flatMap((link) => (link.span ? [link.span] : []));
  return { sources: [...sources.values()], text: replaceSpans(text, spans) };
};

const sourceParts = (sources: Linked["sources"]): MessagePart[] =>
  sources.map((source, i) => ({
    id: `source-${i + 1}`,
    source: { kind: "url", ...source },
    type: "source",
  }));

const joinStrings = (parts: readonly unknown[]): string =>
  parts.filter((part): part is string => typeof part === "string").join("\n");

/** Image and audio parts of a multimodal message; strings become text. */
const multimodalParts = (parts: readonly unknown[]): MessagePart[] =>
  parts.flatMap((part): MessagePart[] => {
    if (typeof part === "string") {
      return part.trim() ? [textPart(part)] : [];
    }
    const asset = assetPointerSchema.safeParse(part);
    if (asset.success) {
      return [
        importedFilePart({
          height: count(asset.data.height),
          mediaType: "image/*",
          origin: "chatgpt",
          ref: asset.data.asset_pointer.slice(0, 2048),
          sizeBytes: count(asset.data.size_bytes),
          width: count(asset.data.width),
        }),
      ];
    }
    const transcription = transcriptionSchema.safeParse(part);
    if (transcription.success) {
      return transcription.data.text.trim()
        ? [textPart(transcription.data.text)]
        : [];
    }
    const kind = z.looseObject({ content_type: z.string() }).safeParse(part);
    return [
      importedContentPart(
        "chatgpt",
        kind.success ? kind.data.content_type : "unknown",
        part
      ),
    ];
  });

/** Files the user attached (`metadata.attachments`): names and sizes only. */
const attachmentParts = (
  metadata: Record<string, unknown> | null | undefined
): MessagePart[] => {
  const list = z.array(attachmentSchema).safeParse(metadata?.attachments);
  return (list.success ? list.data : []).map((attachment) =>
    importedFilePart({
      filename: nonEmpty(attachment.name)?.slice(0, 512),
      mediaType: mediaType(attachment.mime_type),
      origin: "chatgpt",
      ref: nonEmpty(attachment.id)?.slice(0, 2048),
      sizeBytes: count(attachment.size),
    })
  );
};

/** A message's own content as parts, for a user or an assistant speaking to the user. */
const textParts = (message: ChatGptMessage): MessagePart[] => {
  const parsed = textContentSchema.safeParse(message.content);
  const text = parsed.success ? joinStrings(parsed.data.parts) : "";
  if (!text.trim()) {
    return [];
  }
  if (message.author.role === "user") {
    return [textPart(text)];
  }
  const linked = linkCitations(text, message.metadata);
  return [textPart(linked.text), ...sourceParts(linked.sources)];
};

const codeParts = (content: unknown): MessagePart[] | undefined => {
  const parsed = codeContentSchema.safeParse(content);
  if (!parsed.success) {
    return;
  }
  const { language, text } = parsed.data;
  const fence = language && language !== "unknown" ? language : "";
  return [textPart(`\`\`\`${fence}\n${text}\n\`\`\``)];
};

const thoughtParts = (content: unknown): MessagePart[] => {
  const parsed = thoughtsContentSchema.safeParse(content);
  const text = (parsed.data?.thoughts ?? [])
    .map((thought) => thought.content || thought.summary || "")
    .filter(Boolean)
    .join("\n\n");
  return text ? [reasoningPart(text)] : [];
};

/** A message's own content as parts, for a user or an assistant speaking to the user. */
const contentParts = (message: ChatGptMessage): MessagePart[] => {
  const { content } = message;
  switch (content.content_type) {
    case "text":
      return textParts(message);
    case "multimodal_text":
      return multimodalParts(
        textContentSchema.safeParse(content).data?.parts ?? []
      );
    case "code":
      return (
        codeParts(content) ?? [
          importedContentPart("chatgpt", content.content_type, content),
        ]
      );
    case "thoughts":
      return thoughtParts(content);
    case "system_error": {
      const text = nonEmpty(content.text) ?? nonEmpty(content.name);
      return text ? [textPart(text)] : [];
    }
    default:
      return [importedContentPart("chatgpt", content.content_type, content)];
  }
};

/** The input of a call addressed to a tool: code as `{ code, language }`, else the text. */
const toolInput = (message: ChatGptMessage) => {
  const code = codeContentSchema.safeParse(message.content);
  if (code.success) {
    return code.data.language
      ? { code: code.data.text, language: code.data.language }
      : { code: code.data.text };
  }
  const text = textContentSchema.safeParse(message.content);
  return text.success
    ? { text: joinStrings(text.data.parts) }
    : asJson(message.content);
};

/** A tool's reply: a result for the call it answers, or kept as content if there's none. */
const toolReplyParts = (
  message: ChatGptMessage,
  parentId: string | null | undefined,
  parent: ChatGptNode | undefined
): MessagePart[] => {
  const name = message.author.name ?? "tool";
  const images =
    message.content.content_type === "multimodal_text"
      ? multimodalParts(
          textContentSchema.safeParse(message.content).data?.parts ?? []
        ).filter((part) => part.type === "data")
      : [];
  const call = parent?.message;
  if (
    !(parentId && call?.author.role === "assistant") ||
    call.recipient !== name
  ) {
    return [
      importedContentPart(
        "chatgpt",
        message.content.content_type,
        message.content
      ),
      ...images,
    ];
  }
  const failed = message.content.content_type === "system_error";
  return [
    toolResultPart({
      id: toolCallId(parentId, parentId),
      name: toolName(name),
      output: failed
        ? {
            message: nonEmpty(message.content.text) ?? "Tool error",
            status: "error",
          }
        : { status: "success", value: asJson(message.content) },
    }),
    ...images,
  ];
};

const STATUS: Record<string, MessageStatus> = {
  finished_partial_completion: "partial",
  in_progress: "partial",
};

const isPassedOver = (message: ChatGptMessage): boolean =>
  message.author.role === "system" ||
  message.metadata?.is_visually_hidden_from_conversation === true ||
  PASSED_OVER_CONTENT.has(message.content.content_type);

/** A node's parts by who wrote it and whom it's addressed to. */
const nodeParts = (
  id: string,
  node: ChatGptNode,
  message: ChatGptMessage,
  conversation: ChatGptConversation
): MessagePart[] => {
  switch (message.author.role) {
    case "user":
      return [...contentParts(message), ...attachmentParts(message.metadata)];
    case "assistant":
      return message.recipient && message.recipient !== "all"
        ? [
            toolCallPart({
              id: toolCallId(id, id),
              input: toolInput(message),
              name: toolName(message.recipient),
              providerExecuted: true,
            }),
          ]
        : contentParts(message);
    case "tool":
      return toolReplyParts(
        message,
        node.parent,
        node.parent ? conversation.mapping[node.parent] : undefined
      );
    default:
      return [];
  }
};

const toDraft = (
  id: string,
  node: ChatGptNode,
  conversation: ChatGptConversation
): DraftMessage => {
  const draft = {
    body: null,
    parentSourceId: node.parent ?? null,
    sourceId: id,
  };
  const { message } = node;
  if (!message || isPassedOver(message)) {
    return draft;
  }
  const parts = nodeParts(id, node, message, conversation);
  if (parts.length === 0) {
    return draft;
  }
  const user = message.author.role === "user";
  const slug =
    typeof message.metadata?.model_slug === "string"
      ? message.metadata.model_slug
      : conversation.default_model_slug;
  return {
    ...draft,
    body: {
      createdAtMs: validMs((message.create_time ?? Number.NaN) * 1000),
      model: user ? null : modelRef("openai", slug),
      parts,
      // Tool replies are part of the assistant's turn: our roles are user, assistant, system.
      role: user ? "user" : "assistant",
      status:
        message.content.content_type === "system_error"
          ? "error"
          : (STATUS[message.status ?? ""] ?? "complete"),
    },
  };
};

/**
 * One conversation from `conversations.json`. `index` is its position in the
 * export (for the failure report); `now` dates a conversation the export
 * didn't.
 */
export const parseChatGptConversation = (
  raw: unknown,
  index = 0,
  now: () => Date = () => new Date()
): Result<ImportedConversation, ConversationFailure> => {
  const parsed = chatGptConversationSchema.safeParse(raw);
  if (!parsed.success) {
    return err({
      detail: describeIssues(parsed.error),
      index,
      reason: "invalid_shape",
      sourceId: null,
    });
  }
  const conversation = parsed.data;
  const sourceId = conversation.conversation_id ?? conversation.id ?? null;
  const nodes = Object.entries(conversation.mapping);
  if (nodes.length > IMPORT_LIMITS.maxMessagesPerConversation) {
    return err({
      detail: `${nodes.length} nodes`,
      index,
      reason: "too_large",
      sourceId,
    });
  }
  const createdMs =
    validMs((conversation.create_time ?? Number.NaN) * 1000) ?? now().getTime();
  const built = buildTree(
    nodes.map(([id, node]) => toDraft(id, node, conversation)),
    createdMs
  );
  const merged = mergeAssistantChains(built.messages);
  if (merged.messages.length === 0) {
    return err({ index, reason: "empty", sourceId });
  }
  return ok({
    activeLeafSourceId: merged.resolve(
      built.resolve(conversation.current_node)
    ),
    createdAt: new Date(createdMs).toISOString(),
    messages: [...merged.messages],
    source: "chatgpt",
    sourceId,
    title: cleanTitle(conversation.title),
  });
};
