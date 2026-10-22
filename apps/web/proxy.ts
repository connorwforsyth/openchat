import { getSessionCookie } from "better-auth/cookies";
import { type NextRequest, NextResponse } from "next/server";

import { routeParams, routes } from "./lib/routes";

// The optimistic check (Next's proxy guidance): signed-in pages need a
// session cookie, and without one the visit goes straight to sign-in with a
// way back. It only reads the cookie; whether the session is still valid is
// the API's call on every request, and the app layout redirects when it
// says no. Public pages (sign-in, invitations, `/api`, assets) never match.

export function proxy(request: NextRequest) {
  if (getSessionCookie(request)) {
    return NextResponse.next();
  }
  const { pathname, search } = request.nextUrl;
  const target = request.nextUrl.clone();
  target.pathname = routes.signIn;
  target.search = "";
  // Home is where sign-in lands anyway; don't clutter the address with it.
  if (pathname !== routes.home || search) {
    target.searchParams.set(routeParams.next, `${pathname}${search}`);
  }
  return NextResponse.redirect(target);
}

export const config = {
  matcher: [
    "/",
    "/c/:path*",
    "/artifacts/:path*",
    "/dots/:path*",
    "/library/:path*",
    "/space",
    "/settings/:path*",
    "/admin/:path*",
    "/quick",
  ],
};
