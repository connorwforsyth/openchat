import { type APIRequestContext, expect, test } from "@playwright/test";

import { users } from "../support/users";

// Sign-in rate limits behind a proxy (044). The suite's server trusts
// loopback as its proxy (`TRUSTED_PROXIES`, support/serve.ts), so the
// X-Forwarded-For these requests carry reads as if a proxy on this machine
// had added it: each client address gets its own bucket (Better Auth: three
// sign-in attempts per ten seconds), and an address a client writes in
// front of the proxy's entry is never believed.

const signIn = (
  request: APIRequestContext,
  baseURL: string,
  forwardedFor: string
) =>
  request.post("/api/auth/sign-in/email", {
    data: { email: users.ada.email, password: "not-the-password" },
    headers: { origin: baseURL, "x-forwarded-for": forwardedFor },
  });

test("each client behind the proxy has its own sign-in bucket", async ({
  baseURL,
  request,
}) => {
  const origin = baseURL ?? "";
  const alice = "203.0.113.10";
  for (let attempt = 0; attempt < 3; attempt += 1) {
    // biome-ignore lint/performance/noAwaitInLoops: the limit counts attempts in order.
    const refused = await signIn(request, origin, alice);
    expect(refused.status(), `attempt ${attempt + 1}`).toBe(401);
  }
  expect((await signIn(request, origin, alice)).status()).toBe(429);

  // Someone else, behind the same proxy, isn't locked out by Alice.
  expect((await signIn(request, origin, "203.0.113.20")).status()).toBe(401);
  // A trusted hop is looked past, to the client in front of it.
  expect(
    (await signIn(request, origin, "203.0.113.30, 127.0.0.1")).status()
  ).toBe(401);
  // Alice can't pick a fresh bucket by writing an address in front of hers.
  expect(
    (await signIn(request, origin, `198.51.100.7, ${alice}`)).status()
  ).toBe(429);
});
