import { createApiClient } from "@workspace/client/api";
import type { Me } from "@workspace/contract/schemas/meta";
import { getSessionCookie } from "better-auth/cookies";
import { headers } from "next/headers";
import { cache } from "react";

// Who is asking, for server components. Pages never open the database or
// boot the auth server themselves: the API behind `/api` (ticket 038) owns
// both, and a second copy in the page renderer would fight it for the
// embedded database. So the server asks the API, over loopback, with the
// caller's cookie, the same way the browser would.
//
// Best effort: when the API can't be reached the page still renders and the
// browser asks again. Only a definite "not signed in" redirects.

export type ServerViewer =
  | { readonly kind: "signed_in"; readonly me: Me }
  | { readonly kind: "signed_out" }
  /** No answer (API down, timed out, misconfigured); the client retries. */
  | { readonly kind: "unknown" };

/**
 * Marks our own loopback requests. If `/api/me` ever renders a page (no API
 * mounted, so Next's 404 page with the root layout answers it), that page
 * must not ask `/api/me` again, or each lookup waits on the next.
 */
const LOOPBACK_HEADER = "x-loopback-viewer";

/** Long enough for a cold dev compile of the API route, short enough not to hang a page. */
const LOOPBACK_TIMEOUT_MS = 5000;

/**
 * This server, over loopback. Never the request's `Host`: that header is the
 * caller's to choose, and following it would send their cookie (and our
 * requests) wherever they like. Next sets `PORT` for `next dev`/`next start`
 * and the standalone server reads it.
 */
const loopbackOrigin = (): string =>
  `http://localhost:${process.env.PORT?.trim() || "3000"}`;

const statusOf = (error: unknown): number | null =>
  typeof error === "object" &&
  error !== null &&
  "status" in error &&
  typeof error.status === "number"
    ? error.status
    : null;

/** Once per request; the root layout (locale) and the app layout share it. */
export const getViewer = cache(async (): Promise<ServerViewer> => {
  const requestHeaders = await headers();
  // No session cookie: nobody to look up, and no round trip.
  if (!getSessionCookie(requestHeaders)) {
    return { kind: "signed_out" };
  }
  if (requestHeaders.has(LOOPBACK_HEADER)) {
    return { kind: "unknown" };
  }
  const cookie = requestHeaders.get("cookie") ?? "";
  const client = createApiClient({
    baseUrl: loopbackOrigin(),
    headers: () => ({ cookie, [LOOPBACK_HEADER]: "1" }),
  });
  try {
    const me = await client.me.get(undefined, {
      signal: AbortSignal.timeout(LOOPBACK_TIMEOUT_MS),
    });
    return { kind: "signed_in", me };
  } catch (error) {
    return statusOf(error) === 401
      ? { kind: "signed_out" }
      : { kind: "unknown" };
  }
});
