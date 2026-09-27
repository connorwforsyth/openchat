import { implement, ORPCError } from "@orpc/server";
import { contract } from "@workspace/contract/contract";
import type { Db } from "@workspace/db/client";
import type { Page } from "@workspace/db/queries/page";
import type { Result } from "@workspace/shared/result";

import { actorFor, type RequestContext } from "../context";
import type { KnowledgeError } from "../knowledge/errors";
import type { FileHandlers } from "../knowledge/files";
import type { SearchHandlers } from "../knowledge/search";
import {
  featureDisabledError,
  forbiddenError,
  notFoundError,
  temporarilyUnavailableError,
  validationError,
} from "./errors";

// The `files` and `search` groups (021) mounted over their plain-function
// handlers: the session's viewer goes in, a `KnowledgeError` comes out as
// the contract's error of the same code, and `UNAVAILABLE` (storage or the
// embedding provider down) as a 503.

const toOrpcError = (error: KnowledgeError): ORPCError<string, unknown> => {
  switch (error.code) {
    case "NOT_FOUND":
      return notFoundError();
    case "FORBIDDEN":
      return forbiddenError();
    case "VALIDATION":
      return validationError(error.data.issues);
    case "FEATURE_DISABLED":
      return featureDisabledError(error.data.feature);
    case "UNAVAILABLE":
      return temporarilyUnavailableError("files", error.message);
    default:
      return error satisfies never;
  }
};

const unwrap = <T>(result: Result<T, KnowledgeError>): T => {
  if (!result.ok) {
    throw toOrpcError(result.error);
  }
  return result.value;
};

/** The handlers' pages are readonly; oRPC's output types aren't. */
const mutablePage = <T>(page: Page<T>) => ({
  items: [...page.items],
  nextCursor: page.nextCursor,
});

export interface FilesRouterDeps {
  readonly db: Db;
  readonly files: FileHandlers;
  readonly search: SearchHandlers;
}

export const createFilesRouter = ({ db, files, search }: FilesRouterDeps) => {
  const os = implement({
    files: contract.files,
    search: contract.search,
  }).$context<RequestContext>();
  const authed = os.use(async ({ context, next }) => {
    if (!context.session) {
      throw new ORPCError("UNAUTHORIZED");
    }
    return next({
      context: { viewer: await actorFor(db, context.session) },
    });
  });

  return os.router({
    files: {
      delete: authed.files.delete.handler(async ({ context, input }) => {
        unwrap(await files.delete(context, input));
      }),
      get: authed.files.get.handler(async ({ context, input }) =>
        unwrap(await files.get(context, input))
      ),
      getUrl: authed.files.getUrl.handler(async ({ context, input }) =>
        unwrap(await files.getUrl(context, input))
      ),
      list: authed.files.list.handler(async ({ context, input }) =>
        mutablePage(unwrap(await files.list(context, input)))
      ),
      search: authed.files.search.handler(async ({ context, input }) =>
        unwrap(await files.search(context, input))
      ),
      upload: authed.files.upload.handler(async ({ context, input }) =>
        unwrap(await files.upload(context, input))
      ),
    },
    search: {
      conversations: authed.search.conversations.handler(
        async ({ context, input }) =>
          mutablePage(unwrap(await search.conversations(context, input)))
      ),
    },
  });
};
