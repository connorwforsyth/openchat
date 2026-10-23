import { type ApiClient, createApiClient } from "@workspace/client/api";

import { cookieFrom } from "../world";

// The live artifact eval signs in as a person who already exists on the
// running app (the lane's demo account), rather than booting its own server
// as the black-box suites do: it measures the app as it's configured.

export interface LiveSession {
  readonly api: ApiClient;
  readonly cookie: string;
}

export const DEMO_EMAIL = "demo@dots.local";
export const DEMO_PASSWORD = "demo-password-123";

export const signIn = async (
  baseUrl: string,
  email = DEMO_EMAIL,
  password = DEMO_PASSWORD
): Promise<LiveSession> => {
  const response = await fetch(`${baseUrl}/api/auth/sign-in/email`, {
    body: JSON.stringify({ email, password }),
    headers: { "content-type": "application/json", origin: baseUrl },
    method: "POST",
  });
  const cookie = cookieFrom(response);
  if (!(response.ok && cookie)) {
    throw new Error(`couldn't sign in as ${email}: ${response.status}`);
  }
  const api = createApiClient({
    baseUrl,
    batch: false,
    fetch: globalThis.fetch,
    headers: () => ({ cookie, origin: baseUrl }),
  });
  return { api, cookie };
};
