import {
  acceptsFile,
  providerCapabilities,
} from "@workspace/ai/providers/capabilities";
import type { AppConfig } from "@workspace/config/schema";
import type { FileId, UserId } from "@workspace/contract/schemas/common";
import type { MessagePart } from "@workspace/contract/schemas/message-parts";
import type { Message } from "@workspace/contract/schemas/messages";
import {
  type ModelRef,
  parseModelRef,
} from "@workspace/contract/schemas/models";
import type { Db } from "@workspace/db/client";
import { getReadableFile } from "@workspace/db/queries/files";

import { actorFor } from "../context";
import type { Storage } from "../ports/storage";

// A chat's attachments as the model gets them (044). The stored file part
// names an upload by id, whose bytes sit behind an authenticated route no
// provider can fetch, and many models can't read a PDF at all. So each turn:
//
// - a file the model reads (images for `vision`, PDFs for `files`) goes as
//   a file part with its bytes inline;
// - anything else, or a file that can't be read right now, becomes a short
//   note in the message, and the model searches it with `file_search` (the
//   upload is ingested like any attachment, and a plain chat with an
//   indexed attachment is offered the tool).
//
// Either way the turn goes ahead: an attachment never fails it.

type FilePart = Extract<MessagePart, { type: "file" }>;

export interface ModelAttachments {
  /** Whether the turn's model reads this kind of file as a file part. */
  readonly accepts: (mediaType: string) => boolean;
  /** An upload's bytes if `userId` may read it; `null` when it can't be had. */
  readonly read: (userId: UserId, fileId: FileId) => Promise<Uint8Array | null>;
}

/** What the model is told in place of a file it doesn't get. */
export const attachmentNote = (part: FilePart): string => {
  const name = part.filename ?? "an attachment";
  return `[Attached file: ${name} (${part.mediaType}). It isn't shown to you directly; search its contents with the file_search tool when it's offered.]`;
};

const REMOTE_URL = /^(https?|data):/i;

const toBase64 = (bytes: Uint8Array): string =>
  Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString(
    "base64"
  );

/** The part the model gets for `part`: inline bytes, the URL as-is, or `null` for a note. */
const filePartForModel = async (
  part: FilePart,
  userId: UserId,
  attachments: ModelAttachments
): Promise<FilePart | null> => {
  if (!attachments.accepts(part.mediaType)) {
    return null;
  }
  if (part.source.kind === "url") {
    return REMOTE_URL.test(part.source.url) ? part : null;
  }
  const bytes = await attachments
    .read(userId, part.source.fileId)
    .catch(() => null);
  return bytes
    ? {
        ...part,
        source: {
          kind: "url",
          url: `data:${part.mediaType};base64,${toBase64(bytes)}`,
        },
      }
    : null;
};

const withAttachments = async (
  message: Message,
  userId: UserId,
  attachments: ModelAttachments
): Promise<Message> => {
  if (!message.parts.some((part) => part.type === "file")) {
    return message;
  }
  const kept: MessagePart[] = [];
  const notes: MessagePart[] = [];
  for (const part of message.parts) {
    if (part.type !== "file") {
      kept.push(part);
      continue;
    }
    // biome-ignore lint/performance/noAwaitInLoops: a message has a handful of attachments; order matters.
    const forModel = await filePartForModel(part, userId, attachments);
    if (forModel) {
      kept.push(forModel);
    } else {
      notes.push({ text: attachmentNote(part), type: "text" });
    }
  }
  // Notes go after what the person wrote, so their words lead the message.
  return { ...message, parts: [...kept, ...notes] };
};

/**
 * The branch with every file part made fit for the model (see above).
 * Messages without attachments come back as they were.
 */
export const attachmentsForModel = (
  messages: readonly Message[],
  userId: UserId,
  attachments: ModelAttachments
): Promise<Message[]> =>
  Promise.all(
    messages.map((message) => withAttachments(message, userId, attachments))
  );

/** Without a store or capabilities, every attachment is a note. */
export const NO_ATTACHMENTS: ModelAttachments = {
  accepts: () => false,
  read: () => Promise.resolve(null),
};

/** An upload's bytes from `storage`, for someone who may read the file. */
export const uploadReader =
  (db: Db, storage: Storage): ModelAttachments["read"] =>
  async (userId, fileId) => {
    const viewer = await actorFor(db, { userId });
    const found = await getReadableFile(db, viewer, fileId);
    if (!found.ok) {
      return null;
    }
    const object = await storage.get(found.value.storageKey);
    if (!object.ok) {
      return null;
    }
    return new Uint8Array(await new Response(object.value.body).arrayBuffer());
  };

/** How attachments reach `model`, a configured `provider:model` ref. */
export const attachmentsFor = (
  providers: AppConfig["providers"],
  model: ModelRef,
  read: ModelAttachments["read"] | undefined
): ModelAttachments => {
  const provider = parseModelRef(model)?.provider;
  const config = provider ? providers[provider] : undefined;
  const capabilities = config ? providerCapabilities(config) : [];
  return {
    accepts: (mediaType) => acceptsFile(capabilities, mediaType),
    read: read ?? NO_ATTACHMENTS.read,
  };
};
