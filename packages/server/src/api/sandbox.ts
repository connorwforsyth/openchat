import { implement, ORPCError } from "@orpc/server";
import { contract } from "@workspace/contract/contract";
import { conflictError } from "@workspace/contract/errors";
import type {
  ConversationId,
  SandboxId,
} from "@workspace/contract/schemas/common";
import type {
  ExecInput,
  ExecResult,
  FileEntry,
  SandboxProvider,
  SandboxRecord,
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
// the sandbox package's `sandboxHandlerErrorSchema`, which its handlers
// return unchanged.

export const sandboxApiErrorSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("not_found") }),
  z.object({ type: z.literal("forbidden") }),
  z.object({ type: z.literal("already_exists") }),
  z.object({ type: z.literal("feature_disabled") }),
  z.object({ message: z.string(), type: z.literal("invalid") }),
  z.object({ message: z.string(), type: z.literal("unavailable") }),
]);
export type SandboxApiError = z.infer<typeof sandboxApiErrorSchema>;

type Call<I, O> = (viewer: Viewer, input: I) => AsyncResult<O, SandboxApiError>;

/** The sandbox handlers, bound to the instance's providers. */
export interface SandboxApi {
  readonly create: Call<
    {
      readonly conversationId: ConversationId;
      readonly provider?: SandboxProvider;
    },
    SandboxRecord
  >;
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
}

const toOrpcError = (error: SandboxApiError): ORPCError<string, unknown> => {
  switch (error.type) {
    case "not_found":
      return notFoundError();
    case "forbidden":
      return forbiddenError();
    case "already_exists":
      return new ORPCError("CONFLICT", {
        data: { reason: "already_exists" },
        message: conflictError.CONFLICT.message,
        status: conflictError.CONFLICT.status,
      });
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
    destroy: off,
    exec: off,
    exposePort: off,
    get: off,
    listFiles: off,
    readFile: off,
    reset: off,
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
      listFiles: sandbox.listFiles.handler(async ({ context, input }) =>
        unwrap(await api.listFiles(context.viewer, input))
      ),
      readFile: sandbox.readFile.handler(async ({ context, input }) =>
        unwrap(await api.readFile(context.viewer, input))
      ),
      reset: sandbox.reset.handler(async ({ context, input }) =>
        unwrap(await api.reset(context.viewer, input))
      ),
    },
  });
};
