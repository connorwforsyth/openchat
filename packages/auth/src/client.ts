import {
  adminClient,
  inferOrgAdditionalFields,
  organizationClient,
} from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

import type { Auth } from "./server";

// Per-platform Better Auth clients, each with the plugins the server runs so
// their endpoints are typed. Generic OIDC providers register as social ones,
// so `signIn.social({ provider: "<oidc id>" })` covers SSO with no plugin.
//
// Only web exists in M1. Later waves add, next to this one:
// - Expo: `@better-auth/expo/client` with SecureStore (Mobile wave);
// - Electron: `@better-auth/electron`, system browser + PKCE (Desktop wave);
// - Swift and other native clients: no JS client; they call the API with
//   `Authorization: Bearer <token>` (the `bearer` plugin).

const plugins = [
  organizationClient({
    schema: inferOrgAdditionalFields<Auth>(),
  }),
  adminClient(),
];

export interface WebAuthClientOptions {
  /**
   * The app's origin. Omit in the browser (same origin); required wherever
   * there is no `window.location`, like server rendering.
   */
  readonly baseURL?: string;
}

/** The browser client: cookie sessions against `/api/auth` on the app's origin. */
export const createWebAuthClient = ({ baseURL }: WebAuthClientOptions = {}) =>
  createAuthClient({ baseURL, plugins });

export type WebAuthClient = ReturnType<typeof createWebAuthClient>;
