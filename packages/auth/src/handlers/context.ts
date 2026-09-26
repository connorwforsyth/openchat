import { ORPCError, os } from "@orpc/server";
import type { AppConfig } from "@workspace/config/schema";
import type { UserId } from "@workspace/contract/schemas/common";
import type {
  ResourceRef,
  SharedResource,
} from "@workspace/contract/schemas/grants";
import type { Db } from "@workspace/db/client";
import { type AsyncResult, fromPromise } from "@workspace/shared/result";
import { isAPIError } from "better-auth/api";

import type { Auth, AuthSession } from "../server";

// What every handler in this package runs with. The shell (014/025) builds
// it per request: the database, the auth server, the request's headers
// (Better Auth reads the session from them, cookie or bearer) and the
// session it resolved once with `resolveSession`.

/**
 * What a share link shows. The conversation and library workstreams (014,
 * 017) own those reads, so the shell passes this in; without it every link
 * resolves to `NOT_FOUND`.
 */
export type SharedResourceLoader = (
  resource: ResourceRef
) => Promise<SharedResource | null>;

export interface HandlerContext {
  /** The public origin share links point at, like `https://chat.example.com`. */
  readonly appUrl: string;
  readonly auth: Auth;
  readonly config: AppConfig;
  readonly db: Db;
  readonly headers: Headers;
  readonly loadSharedResource?: SharedResourceLoader;
  /** Injected for tests; defaults to the wall clock. */
  readonly now?: () => Date;
  /** `null` for an anonymous request (only `open` procedures accept one). */
  readonly session: AuthSession | null;
}

/** The request's session, or `null`. Call once per request and put it in the context. */
export const resolveSession = async (
  auth: Auth,
  headers: Headers
): Promise<AuthSession | null> => auth.api.getSession({ headers });

/** Requires a session and adds the caller's id, so handlers never re-check. */
export const requireSession = os
  .$context<HandlerContext>()
  .middleware(({ context, next }) => {
    if (!context.session) {
      throw new ORPCError("UNAUTHORIZED");
    }
    return next({
      context: {
        session: context.session,
        userId: context.session.user.id as UserId,
      },
    });
  });

/** A Better Auth call refused with a status and (usually) an error code. */
export interface AuthRefusal {
  readonly code: string;
  readonly status: string;
}

/**
 * Runs a Better Auth server call, turning its `APIError` into a value the
 * handler maps to our typed errors. Anything else is a bug and still throws.
 */
export const viaAuth = <T>(
  run: () => Promise<T>
): AsyncResult<T, AuthRefusal> =>
  fromPromise(run, (cause) => {
    if (!isAPIError(cause)) {
      throw cause;
    }
    return {
      code: String(cause.body?.code ?? cause.status),
      status: String(cause.status),
    };
  });

export const nowOf = (context: HandlerContext): Date =>
  context.now?.() ?? new Date();
