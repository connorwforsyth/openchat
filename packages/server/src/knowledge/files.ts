import { createHash } from "node:crypto";
import type { Embedder } from "@workspace/ai/ports/embedder";
import { searchFiles } from "@workspace/ai/rag/file-search";
import type { AppConfig } from "@workspace/config/schema";
import type { ConversationId } from "@workspace/contract/schemas/common";
import type {
  FileRecord,
  FileSearchHit,
  fileSearchInputSchema,
  listFilesInputSchema,
  uploadFileInputSchema,
} from "@workspace/contract/schemas/files";
import type { Db } from "@workspace/db/client";
import {
  getConversation,
  type Viewer,
} from "@workspace/db/queries/conversations";
import {
  createFile,
  deleteFile,
  type FileRow,
  getReadableFile,
  listFiles,
  listReadableIndexedFileIds,
  replaceChunks,
  searchChunks,
  setFileState,
  toFileRecord,
} from "@workspace/db/queries/files";
import type { Page } from "@workspace/db/queries/page";
import { newId } from "@workspace/shared/ids";
import { type AsyncResult, err, ok } from "@workspace/shared/result";
import type { z } from "zod";

import type { Storage } from "../ports/storage";
import {
  featureDisabled,
  forbidden,
  invalid,
  type KnowledgeError,
  notFound,
  unavailable,
} from "./errors";
import { enqueueIngest, type KnowledgeQueue } from "./ingestion";
import { checkUpload } from "./uploads";

// Handlers for the contract's `files` group, as plain functions over their
// ports; the oRPC mount (ticket 025) calls them with the session's viewer
// and maps a `KnowledgeError` to the typed error of the same code. Access
// is ownership, or reading the chat a file is attached to (`getReadableFile`).

export interface KnowledgeContext {
  readonly viewer: Viewer;
}

export interface FileHandlerDeps {
  readonly config: Pick<AppConfig, "features" | "limits">;
  readonly db: Db;
  /** `null` when `embeddings.model` isn't set: uploads work, nothing is indexed. */
  readonly embedder: Embedder | null;
  readonly queue: KnowledgeQueue;
  readonly storage: {
    readonly driver: "local" | "s3";
    readonly storage: Storage;
  };
}

/** Signed download links live this long. */
export const DOWNLOAD_URL_SECONDS = 300;

/** Most files `files.search` looks across when the caller names none. */
const SEARCH_SCOPE_LIMIT = 500;

type UploadInput = z.output<typeof uploadFileInputSchema>;
type ListInput = z.output<typeof listFilesInputSchema>;
type SearchInput = z.output<typeof fileSearchInputSchema>;
interface ById {
  readonly id: FileRecord["id"];
}

/** The caller must be able to post in a chat to attach files to it. */
const canAttach = async (
  db: Db,
  viewer: Viewer,
  conversationId: ConversationId
): AsyncResult<void, KnowledgeError> => {
  const found = await getConversation(db, conversationId, viewer);
  if (!found.ok) {
    return err(notFound);
  }
  return found.value.myPermission === "owner" ||
    found.value.myPermission === "editor"
    ? ok(undefined)
    : err(forbidden);
};

export const createFileHandlers = ({
  config,
  db,
  embedder,
  queue,
  storage,
}: FileHandlerDeps) => {
  /** Queues ingestion for a file worth indexing; anything else is ready now. */
  const startIndexing = async (
    row: FileRow,
    index: boolean
  ): Promise<FileRow> => {
    if (!index) {
      const ready = await replaceChunks(db, row.id, [], null);
      return ready.ok ? ready.value : row;
    }
    const queued = await enqueueIngest(queue, row.id);
    if (queued.ok) {
      return row;
    }
    const failed = await setFileState(
      db,
      row.id,
      "failed",
      "The file couldn't be queued for indexing."
    );
    return failed.ok ? failed.value : row;
  };

  return {
    delete: async (
      { viewer }: KnowledgeContext,
      { id }: ById
    ): AsyncResult<void, KnowledgeError> => {
      const found = await getReadableFile(db, viewer, id);
      if (!found.ok) {
        return err(notFound);
      }
      if (found.value.ownerId !== viewer.userId) {
        return err(forbidden);
      }
      const deleted = await deleteFile(db, id);
      if (deleted.ok) {
        // The row is gone either way; bytes left behind by a storage hiccup
        // are unreachable, and a sweep can collect them later.
        await storage.storage.delete(deleted.value.storageKey);
      }
      return ok(undefined);
    },

    get: async (
      { viewer }: KnowledgeContext,
      { id }: ById
    ): AsyncResult<FileRecord, KnowledgeError> => {
      const found = await getReadableFile(db, viewer, id);
      return found.ok ? ok(toFileRecord(found.value)) : err(notFound);
    },

    getUrl: async (
      { viewer }: KnowledgeContext,
      { id }: ById
    ): AsyncResult<{ expiresAt: string; url: string }, KnowledgeError> => {
      const found = await getReadableFile(db, viewer, id);
      if (!found.ok) {
        return err(notFound);
      }
      const signed = await storage.storage.signedUrl(found.value.storageKey, {
        expiresInSeconds: DOWNLOAD_URL_SECONDS,
        method: "GET",
      });
      if (!signed.ok) {
        return err(
          signed.error.type === "unavailable"
            ? unavailable(signed.error.message)
            : notFound
        );
      }
      return ok({ ...signed.value });
    },

    list: async (
      { viewer }: KnowledgeContext,
      input: ListInput
    ): AsyncResult<Page<FileRecord>, KnowledgeError> => {
      if (input.conversationId) {
        const chat = await getConversation(db, input.conversationId, viewer);
        if (!chat.ok) {
          return err(notFound);
        }
      }
      const page = await listFiles(db, viewer, input);
      if (!page.ok) {
        return err(invalid(["cursor"], "The cursor isn't valid."));
      }
      return ok({
        items: page.value.items.map(toFileRecord),
        nextCursor: page.value.nextCursor,
      });
    },

    search: async (
      { viewer }: KnowledgeContext,
      input: SearchInput
    ): AsyncResult<FileSearchHit[], KnowledgeError> => {
      if (!embedder) {
        return err(featureDisabled("file_search"));
      }
      const fileIds = await listReadableIndexedFileIds(db, viewer, {
        fileIds: input.fileIds,
        limit: SEARCH_SCOPE_LIMIT,
      });
      const result = await searchFiles(
        { embedder, searchChunks: (query) => searchChunks(db, query) },
        { fileIds, limit: input.limit, query: input.query }
      );
      return result.ok
        ? ok([...result.hits])
        : err(unavailable(result.message));
    },

    upload: async (
      { viewer }: KnowledgeContext,
      input: UploadInput
    ): AsyncResult<FileRecord, KnowledgeError> => {
      if (!config.features.fileUploads) {
        return err(featureDisabled("fileUploads"));
      }
      if (input.conversationId) {
        const allowed = await canAttach(db, viewer, input.conversationId);
        if (!allowed.ok) {
          return allowed;
        }
      }
      const bytes = new Uint8Array(await input.file.arrayBuffer());
      const checked = checkUpload({
        bytes,
        maxBytes: config.limits.uploadMaxMb * 1024 * 1024,
        mediaType: input.file.type,
        name: input.file.name,
      });
      if (!checked.ok) {
        return err(invalid(["file"], checked.message));
      }

      // Keys are ours, never the user's file name (the Storage port's rule).
      const storageKey = `files/${viewer.userId}/${newId("x")}`;
      const stored = await storage.storage.put(storageKey, bytes, {
        contentType: checked.storedType,
      });
      if (!stored.ok) {
        return err(
          unavailable("The file couldn't be stored. Try again shortly.")
        );
      }
      const row = await createFile(db, {
        conversationId: input.conversationId ?? null,
        mediaType: checked.mediaType,
        name: input.file.name.slice(0, 512) || "file",
        ownerId: viewer.userId,
        purpose: input.purpose,
        sha256: createHash("sha256").update(bytes).digest("hex"),
        size: bytes.length,
        storageDriver: storage.driver,
        storageKey,
      });

      const indexed = await startIndexing(
        row,
        embedder !== null && checked.indexable && input.purpose !== "skill"
      );
      return ok(toFileRecord(indexed));
    },
  };
};

export type FileHandlers = ReturnType<typeof createFileHandlers>;
