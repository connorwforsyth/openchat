import { ORPCError } from "@orpc/server";
import { baseErrors, featureError } from "@workspace/contract/errors";

// Error helpers shared by the routers that wrap plain-function handlers
// (files, search, MCP, sandboxes). Each builds the contract's error with the
// contract's own status and message, so the wire matches what a typed
// `errors.X(...)` would send even where a procedure's error map lacks it.

export const notFoundError = () =>
  new ORPCError("NOT_FOUND", baseErrors.NOT_FOUND);

export const forbiddenError = () =>
  new ORPCError("FORBIDDEN", baseErrors.FORBIDDEN);

export const validationError = (
  issues: readonly {
    readonly message: string;
    readonly path: readonly (string | number)[];
  }[]
) =>
  new ORPCError("VALIDATION", {
    data: {
      issues: issues.map(({ message, path }) => ({ message, path: [...path] })),
    },
    message: baseErrors.VALIDATION.message,
    status: baseErrors.VALIDATION.status,
  });

export const featureDisabledError = (feature: string) =>
  new ORPCError("FEATURE_DISABLED", {
    data: { feature },
    message: featureError.FEATURE_DISABLED.message,
    status: featureError.FEATURE_DISABLED.status,
  });

/**
 * Something the feature depends on is down (storage, the embedding
 * provider, the sandbox runner). Not the caller's doing and not permanent,
 * so it's a 503; the code stays `FEATURE_DISABLED` because the contract has
 * no other code for "not available right now" (Q29), and clients already
 * render that one as "this isn't available".
 */
export const temporarilyUnavailableError = (feature: string, message: string) =>
  new ORPCError("FEATURE_DISABLED", {
    data: { feature },
    message,
    status: 503,
  });
