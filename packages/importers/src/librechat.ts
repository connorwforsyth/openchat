import type { MessagePart } from "@workspace/contract/schemas/message-parts";
import type { MessageStatus } from "@workspace/contract/schemas/messages";
import { err, ok, type Result } from "@workspace/shared/result";
import { z } from "zod";

import {
  cleanTitle,
  count,
  importedFilePart,
  mediaType,
  modelRef,
  nonEmpty,
  parseArguments,
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
import { buildTree, type DraftMessage, msFromString, validMs } from "./tree";

// LibreChat's conversation export (Export -> JSON): one conversation per
// file, `messages` either flat with `parentMessageId` or, when `recursive`,
// nested under `children`. Ported from LibreChat's `importLibreChatConvo`
// (MIT, see NOTICE). The branch tree is kept as is.
//
// A message's `content` (agents and assistants endpoints) is preferred over
// its `text`, which is derived from it. UI-only parts (activity labels,
// agent updates, summaries) are dropped, like LibreChat's own sanitising
// does; so are empty messages, whose children move up to their parent
// rather than vanishing with them as they do in LibreChat.

/** LibreChat's "no parent" id (`Constants.NO_PARENT`). */
const NO_PARENT = "00000000-0000-0000-0000-000000000000";

const flagSchema = z.union([z.boolean(), z.string()]).nullish();

// Children are validated one node at a time (see `flatten`), not by a
// recursive schema: a long conversation nests thousands deep.
const libreChatMessageSchema = z.looseObject({
  children: z.array(z.unknown()).nullish(),
  content: z.array(z.unknown()).nullish(),
  createdAt: z.union([z.string(), z.number()]).nullish(),
  endpoint: z.string().nullish(),
  error: flagSchema,
  files: z.array(z.unknown()).nullish(),
  isCreatedByUser: flagSchema,
  messageId: z.string().min(1),
  model: z.string().nullish(),
  parentMessageId: z.string().nullish(),
  text: z.string().nullish(),
  unfinished: flagSchema,
});
type LibreChatMessage = z.infer<typeof libreChatMessageSchema>;

export const libreChatExportSchema = z.looseObject({
  conversationId: z.string(),
  endpoint: z.string().nullish(),
  messages: z.array(z.unknown()).nullish(),
  messagesTree: z.array(z.unknown()).nullish(),
  options: z
    .looseObject({
      endpoint: z.string().nullish(),
      model: z.string().nullish(),
    })
    .nullish(),
  title: z.string().nullish(),
});

/** Whether `value` looks like a LibreChat export (for format detection). */
export const isLibreChatExport = (value: unknown): boolean =>
  typeof value === "object" &&
  value !== null &&
  "conversationId" in value &&
  ("messages" in value || "messagesTree" in value);

const truthy = (flag: boolean | string | null | undefined): boolean =>
  flag === true || flag === "true";

/** LibreChat endpoint names as model ref providers. Custom endpoints keep their own name. */
const PROVIDERS: Record<string, string> = {
  agents: "agents",
  anthropic: "anthropic",
  assistants: "openai",
  azureAssistants: "azure",
  azureOpenAI: "azure",
  bedrock: "bedrock",
  google: "google",
  openAI: "openai",
};

const textValue = (value: unknown): string | undefined =>
  typeof value === "string"
    ? value
    : nonEmpty(z.object({ value: z.string() }).safeParse(value).data?.value);

const toolCallSchema = z.looseObject({
  args: z.unknown(),
  function: z
    .looseObject({
      arguments: z.unknown(),
      name: z.string().nullish(),
      output: z.unknown(),
    })
    .nullish(),
  id: z.string().nullish(),
  name: z.string().nullish(),
  output: z.unknown(),
});

const imageFileSchema = z.looseObject({
  file_id: z.string().nullish(),
  filename: z.string().nullish(),
  filepath: z.string().nullish(),
  height: z.number().nullish(),
  width: z.number().nullish(),
});

const fileSchema = imageFileSchema.extend({
  bytes: z.number().nullish(),
  type: z.string().nullish(),
});

/** A call and, when it ran, its result: LibreChat keeps both on one part. */
const toolCallParts = (raw: unknown, fallbackId: string): MessagePart[] => {
  const call = toolCallSchema.safeParse(raw);
  if (!call.success) {
    return [];
  }
  const { args, function: fn, id: rawId, name: rawName } = call.data;
  const id = toolCallId(rawId, fallbackId);
  const name = toolName(rawName ?? fn?.name);
  const output = call.data.output ?? fn?.output;
  const parts = [
    toolCallPart({ id, input: parseArguments(args ?? fn?.arguments), name }),
  ];
  if (output === undefined || output === null) {
    return parts;
  }
  return [
    ...parts,
    toolResultPart({
      id,
      name,
      output: { status: "success", value: parseArguments(output) },
    }),
  ];
};

const imageUrlParts = (raw: unknown): MessagePart[] => {
  const url =
    textValue(raw) ??
    textValue(z.object({ url: z.string() }).safeParse(raw).data?.url);
  // Inline `data:` images would copy megabytes into a record of the file.
  return url && !url.startsWith("data:")
    ? [
        importedFilePart({
          mediaType: "image/*",
          origin: "librechat",
          ref: url.slice(0, 2048),
        }),
      ]
    : [];
};

const statusOf = (message: LibreChatMessage): MessageStatus => {
  if (truthy(message.error)) {
    return "error";
  }
  return truthy(message.unfinished) ? "partial" : "complete";
};

/** `content` parts as ours; `null` for a part that's UI-only. */
const contentPart = (
  part: unknown,
  messageId: string,
  i: number
): MessagePart[] => {
  const typed = z.looseObject({ type: z.string() }).safeParse(part);
  if (!typed.success) {
    return [];
  }
  const value = typed.data;
  switch (value.type) {
    case "text": {
      const text = textValue(value.text);
      return text?.trim() ? [textPart(text)] : [];
    }
    case "think": {
      const text = textValue(value.think);
      return text?.trim() ? [reasoningPart(text)] : [];
    }
    case "error": {
      const text = textValue(value.error) ?? textValue(value.text);
      return text ? [textPart(text)] : [];
    }
    case "tool_call":
      return toolCallParts(value.tool_call, `${messageId}-${i}`);
    case "image_file": {
      const file = imageFileSchema.safeParse(value.image_file);
      return file.success ? [filePart(file.data)] : [];
    }
    case "image_url":
      return imageUrlParts(value.image_url);
    default:
      return [];
  }
};

const filePart = (file: z.infer<typeof fileSchema>): MessagePart =>
  importedFilePart({
    filename: nonEmpty(file.filename)?.slice(0, 512),
    height: count(file.height),
    mediaType: mediaType(file.type),
    origin: "librechat",
    ref: (nonEmpty(file.file_id) ?? nonEmpty(file.filepath))?.slice(0, 2048),
    sizeBytes: count(file.bytes),
    width: count(file.width),
  });

const messageParts = (message: LibreChatMessage): MessagePart[] => {
  const content = (message.content ?? []).flatMap((part, i) =>
    contentPart(part, message.messageId, i)
  );
  const files = (message.files ?? []).flatMap((raw) => {
    const file = fileSchema.safeParse(raw);
    return file.success ? [filePart(file.data)] : [];
  });
  const body =
    content.length > 0 || !message.text?.trim()
      ? content
      : [textPart(message.text)];
  return [...body, ...files];
};

interface Flattened {
  readonly message: LibreChatMessage;
  readonly parentId: string | null;
}

type FlattenError = Pick<ConversationFailure, "detail" | "reason">;

/**
 * Every message, flat, with its parent: the enclosing node for nested
 * `children`, else `parentMessageId`. Iterative, so depth is no limit.
 */
const flatten = (
  roots: readonly unknown[]
): Result<Flattened[], FlattenError> => {
  const out: Flattened[] = [];
  const stack: { parentId: string | null; raw: unknown }[] = [...roots]
    .reverse()
    .map((raw) => ({ parentId: null, raw }));
  while (stack.length > 0) {
    const { parentId, raw } = stack.pop() as (typeof stack)[number];
    const parsed = libreChatMessageSchema.safeParse(raw);
    if (!parsed.success) {
      return err({
        detail: describeIssues(parsed.error),
        reason: "invalid_shape",
      });
    }
    if (out.length >= IMPORT_LIMITS.maxMessagesPerConversation) {
      return err({
        detail: `over ${out.length} messages`,
        reason: "too_large",
      });
    }
    const message = parsed.data;
    const ownParent =
      message.parentMessageId && message.parentMessageId !== NO_PARENT
        ? message.parentMessageId
        : null;
    out.push({ message, parentId: parentId ?? ownParent });
    for (const child of [...(message.children ?? [])].reverse()) {
      stack.push({ parentId: message.messageId, raw: child });
    }
  }
  return ok(out);
};

const createdMs = (value: string | number | null | undefined): number | null =>
  typeof value === "number" ? validMs(value) : msFromString(value);

/**
 * A LibreChat export. `index` is its position when several are imported
 * together; `now` dates an export with no timestamps at all.
 */
export const parseLibreChatExport = (
  raw: unknown,
  index = 0,
  now: () => Date = () => new Date()
): Result<ImportedConversation, ConversationFailure> => {
  const parsed = libreChatExportSchema.safeParse(raw);
  if (!parsed.success) {
    return err({
      detail: describeIssues(parsed.error),
      index,
      reason: "invalid_shape",
      sourceId: null,
    });
  }
  const exported = parsed.data;
  const sourceId = exported.conversationId;
  const flat = flatten(exported.messagesTree ?? exported.messages ?? []);
  if (!flat.ok) {
    return err({ ...flat.error, index, sourceId });
  }
  const endpoint = exported.endpoint ?? exported.options?.endpoint ?? "openAI";
  const provider = PROVIDERS[endpoint] ?? endpoint;
  const drafts = flat.value.map(({ message, parentId }): DraftMessage => {
    const user = truthy(message.isCreatedByUser);
    const parts = messageParts(message);
    return {
      body:
        parts.length > 0
          ? {
              createdAtMs: createdMs(message.createdAt),
              model: user
                ? null
                : modelRef(
                    PROVIDERS[message.endpoint ?? ""] ??
                      message.endpoint ??
                      provider,
                    message.model ?? exported.options?.model
                  ),
              parts,
              role: user ? "user" : "assistant",
              status: statusOf(message),
            }
          : null,
      parentSourceId: parentId,
      sourceId: message.messageId,
    };
  });
  const times = drafts.flatMap((draft) =>
    typeof draft.body?.createdAtMs === "number" ? [draft.body.createdAtMs] : []
  );
  const firstMs =
    times.length > 0 ? times.reduce((a, b) => Math.min(a, b)) : now().getTime();
  const built = buildTree(drafts, firstMs);
  if (built.messages.length === 0) {
    return err({ index, reason: "empty", sourceId });
  }
  return ok({
    // The export doesn't record which branch was open; the newest leaf is shown.
    activeLeafSourceId: null,
    createdAt: new Date(firstMs).toISOString(),
    messages: [...built.messages],
    source: "librechat",
    sourceId,
    title: cleanTitle(exported.title),
  });
};
