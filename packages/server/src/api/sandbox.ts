import { createHash } from "node:crypto";

import { implement, ORPCError } from "@orpc/server";
import { contract } from "@workspace/contract/contract";
import {
  type ConflictReason,
  conflictError,
  featureError,
} from "@workspace/contract/errors";
import type {
  ConversationId,
  SandboxId,
} from "@workspace/contract/schemas/common";
import type {
  DeleteFileInput,
  ExecInput,
  ExecResult,
  FileEntry,
  ImportFileInput,
  SandboxFileEncoding,
  SandboxFileWrite,
  SandboxProvider,
  SandboxRecord,
  WriteFileInput,
} from "@workspace/contract/schemas/sandbox";
import type { Db } from "@workspace/db/client";
import type { Viewer } from "@workspace/db/queries/conversations";
import type { AsyncResult, Result } from "@workspace/shared/result";
import { z } from "zod";

import { actorFor, type RequestContext } from "../context";
import {
  featureDisabledError,
  forbiddenError,
  notFoundError,
  temporarilyUnavailableError,
  validationError,
} from "./errors";

// The `sandbox` group (019). `@workspace/sandbox` already depends on this
// package (for the Storage and JobQueue ports), so this one can't import its
// handlers without a cycle; the shell that has both (`apps/web`) binds them
// into a `SandboxApi` and this router mounts that. The error union mirrors
// the sandbox package's `sandboxHandlerErrorSchema` and, for the workspace
// file writes, its `workspaceFileErrorSchema`, which its handlers return
// unchanged.

export const sandboxApiErrorSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("not_found") }),
  z.object({ type: z.literal("forbidden") }),
  z.object({ type: z.literal("already_exists") }),
  z.object({ type: z.literal("feature_disabled") }),
  z.object({ message: z.string(), type: z.literal("invalid") }),
  z.object({ message: z.string(), type: z.literal("unavailable") }),
  /** A workspace file write that lost to the file's current state (059). */
  z.object({
    reason: z.enum(["version_mismatch", "not_empty"]),
    type: z.literal("conflict"),
  }),
]);
export type SandboxApiError = z.infer<typeof sandboxApiErrorSchema>;

type Call<I, O> = (viewer: Viewer, input: I) => AsyncResult<O, SandboxApiError>;

/**
 * The sandbox handlers, bound to the instance's providers. The workspace
 * file writes (`writeFile`, `importFile`, `deleteFile`, 055) are optional:
 * the sandbox package implements them (059), but a shell that binds an api
 * without one gets a route that says the feature is off.
 */
export interface SandboxApi {
  readonly create: Call<
    {
      readonly conversationId: ConversationId;
      readonly provider?: SandboxProvider;
    },
    SandboxRecord
  >;
  readonly deleteFile?: Call<DeleteFileInput, void>;
  readonly destroy: Call<{ readonly id: SandboxId }, void>;
  readonly exec: Call<ExecInput & { readonly id: SandboxId }, ExecResult>;
  readonly exposePort: Call<
    { readonly id: SandboxId; readonly port: number },
    { port: number; url: string }
  >;
  readonly get: Call<
    { readonly conversationId: ConversationId },
    SandboxRecord | null
  >;
  readonly importFile?: Call<ImportFileInput, SandboxFileWrite>;
  readonly listFiles: Call<
    {
      readonly id: SandboxId;
      readonly path: string;
      readonly recursive: boolean;
    },
    FileEntry[]
  >;
  readonly readFile: Call<
    { readonly id: SandboxId; readonly path: string },
    {
      content: string;
      encoding: "utf8" | "base64";
      path: string;
      size: number;
    }
  >;
  readonly reset: Call<{ readonly id: SandboxId }, SandboxRecord>;
  readonly writeFile?: Call<WriteFileInput, SandboxFileWrite>;
}

const conflict = (reason: ConflictReason) =>
  new ORPCError("CONFLICT", {
    data: { reason },
    message: conflictError.CONFLICT.message,
    status: conflictError.CONFLICT.status,
  });

const toOrpcError = (error: SandboxApiError): ORPCError<string, unknown> => {
  switch (error.type) {
    case "not_found":
      return notFoundError();
    case "forbidden":
      return forbiddenError();
    case "already_exists":
      return conflict("already_exists");
    case "conflict":
      return conflict(error.reason);
    case "feature_disabled":
      return featureDisabledError("sandboxes");
    case "invalid":
      return validationError([{ message: error.message, path: [] }]);
    case "unavailable":
      return temporarilyUnavailableError("sandboxes", error.message);
    default:
      return error satisfies never;
  }
};

const unwrap = <T>(result: Result<T, SandboxApiError>): T => {
  if (!result.ok) {
    throw toOrpcError(result.error);
  }
  return result.value;
};

/**
 * `readFile`'s etag: the lowercase hex SHA-256 of the file's bytes, which
 * `writeFile`'s `ifMatch` compares against. Computed here from what the
 * provider returned, so providers don't each need to hash.
 */
export const fileEtag = (
  content: string,
  encoding: SandboxFileEncoding
): string =>
  createHash("sha256")
    .update(Buffer.from(content, encoding === "base64" ? "base64" : "utf8"))
    .digest("hex");

/**
 * A workspace file write the bound sandbox package doesn't offer yet. Off
 * for this build rather than down, so it's the contract's 403, not a 503.
 */
const notYet = () =>
  new ORPCError("FEATURE_DISABLED", {
    data: { feature: "sandboxes" },
    message: "Workspace file writes aren't available yet.",
    status: featureError.FEATURE_DISABLED.status,
  });

/**
 * Stands in when the shell has no sandbox wiring: every call says the
 * feature is off, which is what an instance without providers says anyway.
 */
export const disabledSandboxApi: SandboxApi = (() => {
  const off = () =>
    Promise.resolve({
      error: { type: "feature_disabled" } as const,
      ok: false as const,
    });
  return {
    create: off,
    deleteFile: off,
    destroy: off,
    exec: off,
    exposePort: off,
    get: off,
    importFile: off,
    listFiles: off,
    readFile: off,
    reset: off,
    writeFile: off,
  };
})();

export const createSandboxRouter = ({
  api,
  db,
}: {
  readonly api: SandboxApi;
  readonly db: Db;
}) => {
  const os = implement({
    sandbox: contract.sandbox,
  }).$context<RequestContext>();
  const authed = os.use(async ({ context, next }) => {
    if (!context.session) {
      throw new ORPCError("UNAUTHORIZED");
    }
    return next({
      context: { viewer: await actorFor(db, context.session) },
    });
  });
  const { sandbox } = authed;

  return os.router({
    sandbox: {
      create: sandbox.create.handler(async ({ context, input }) =>
        unwrap(await api.create(context.viewer, input))
      ),
      deleteFile: sandbox.deleteFile.handler(async ({ context, input }) => {
        if (!api.deleteFile) {
          throw notYet();
        }
        unwrap(await api.deleteFile(context.viewer, input));
      }),
      destroy: sandbox.destroy.handler(async ({ context, input }) => {
        unwrap(await api.destroy(context.viewer, input));
      }),
      exec: sandbox.exec.handler(async ({ context, input }) =>
        unwrap(await api.exec(context.viewer, input))
      ),
      exposePort: sandbox.exposePort.handler(async ({ context, input }) =>
        unwrap(await api.exposePort(context.viewer, input))
      ),
      get: sandbox.get.handler(async ({ context, input }) =>
        unwrap(await api.get(context.viewer, input))
      ),
      importFile: sandbox.importFile.handler(async ({ context, input }) => {
        if (!api.importFile) {
          throw notYet();
        }
        return unwrap(await api.importFile(context.viewer, input));
      }),
      listFiles: sandbox.listFiles.handler(async ({ context, input }) =>
        unwrap(await api.listFiles(context.viewer, input))
      ),
      readFile: sandbox.readFile.handler(async ({ context, input }) => {
        const file = unwrap(await api.readFile(context.viewer, input));
        return { ...file, etag: fileEtag(file.content, file.encoding) };
      }),
      reset: sandbox.reset.handler(async ({ context, input }) =>
        unwrap(await api.reset(context.viewer, input))
      ),
      writeFile: sandbox.writeFile.handler(async ({ context, input }) => {
        if (!api.writeFile) {
          throw notYet();
        }
        return unwrap(await api.writeFile(context.viewer, input));
      }),
    },
  });
};
