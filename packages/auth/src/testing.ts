import { type AppConfig, appConfigSchema } from "@workspace/config/schema";
import type { UserId } from "@workspace/contract/schemas/common";
import { createTestDb, type TestDb } from "@workspace/db/testing";

import { type Auth, createAuth } from "./server";

// Test helpers for anything that needs a real auth server over a test
// database (`import { createTestAuth } from "@workspace/auth/testing"`).
// Sign-ins return bearer headers, which is how a request authenticates in
// tests and on native clients alike.

// Test-only hashing: a plain SHA-256 so suites don't spend seconds in scrypt.
// Never used outside tests; `createAuth` keeps Better Auth's default otherwise.
const sha256 = async (value: string): Promise<string> => {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value)
  );
  return Buffer.from(digest).toString("hex");
};

export const fastTestHasher = {
  hash: (password: string) => sha256(password),
  verify: async ({ hash, password }: { hash: string; password: string }) =>
    (await sha256(password)) === hash,
};

export interface TestAuth extends TestDb {
  readonly auth: Auth;
  readonly config: AppConfig;
}

/** A migrated test database with an auth server over it; `auth` config merged over defaults. */
export const createTestAuth = async (
  auth: Record<string, unknown> = {},
  overrides: Record<string, unknown> = {}
): Promise<TestAuth> => {
  const testDb = await createTestDb();
  const config = appConfigSchema.parse({ ...overrides, auth });
  const created = createAuth({
    config,
    db: testDb.db,
    env: { BETTER_AUTH_SECRET: "test-secret-0123456789abcdefghijklmnop" },
    log: { warn: () => undefined },
    passwordHasher: fastTestHasher,
  });
  if (!created.ok) {
    throw new Error(`createTestAuth: ${created.error.type}`);
  }
  return { ...testDb, auth: created.value, config };
};

export interface SignedIn {
  /** `Authorization: Bearer …`, for `auth.api.*` calls and handler contexts. */
  readonly headers: Headers;
  readonly userId: UserId;
}

const bearerHeaders = (token: string): Headers =>
  new Headers({ authorization: `Bearer ${token}` });

/** Signs up with email and password; throws Better Auth's error if refused. */
export const signUp = async (
  auth: Auth,
  email: string,
  name = email.split("@")[0] ?? email
): Promise<SignedIn> => {
  const result = await auth.api.signUpEmail({
    body: { email, name, password: "correct-horse-battery" },
  });
  if (!result.token) {
    throw new Error("signUp: no session token");
  }
  return {
    headers: bearerHeaders(result.token),
    userId: result.user.id as UserId,
  };
};
