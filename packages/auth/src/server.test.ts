import { appConfigSchema } from "@workspace/config/schema";
import {
  member,
  organization,
  session as sessionTable,
  user,
} from "@workspace/db/schema/auth";
import { createTestDb } from "@workspace/db/testing";
import { idTimestamp } from "@workspace/shared/ids";
import { isAPIError } from "better-auth/api";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DEV_ONLY_SECRET } from "./env";
import { createAuth } from "./server";
import { createTestAuth, signUp, type TestAuth } from "./testing";

let current: TestAuth | undefined;

const UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const setup = async (auth: Record<string, unknown> = {}) => {
  current = await createTestAuth(auth);
  return current;
};

afterEach(async () => {
  vi.unstubAllGlobals();
  await current?.close();
  current = undefined;
});

/** The Better Auth error code a refused call threw. */
const refusal = async (promise: Promise<unknown>): Promise<string> => {
  try {
    await promise;
  } catch (error) {
    if (isAPIError(error)) {
      return String(error.body?.code ?? error.status);
    }
    throw error;
  }
  throw new Error("expected the call to be refused");
};

describe("sign-up", () => {
  it("creates a hidden personal org with the user as its owner", async () => {
    const { auth, db } = await setup();
    const { userId } = await signUp(auth, "ada@example.test");

    const rows = await db
      .select({
        isPersonal: organization.isPersonal,
        role: member.role,
        slug: organization.slug,
      })
      .from(member)
      .innerJoin(organization, eq(organization.id, member.organizationId))
      .where(eq(member.userId, userId));
    expect(rows).toEqual([
      {
        isPersonal: true,
        role: "owner",
        slug: `personal-${userId.replaceAll("-", "")}`,
      },
    ]);
  });

  it("makes the first user the instance admin, and nobody after", async () => {
    const { auth, db } = await setup({ signup: "open" });
    const first = await signUp(auth, "first@example.test");
    const second = await signUp(auth, "second@example.test");

    const roles = await db
      .select({ id: user.id, role: user.role })
      .from(user)
      .orderBy(user.createdAt);
    expect(roles).toEqual([
      { id: first.userId, role: "admin" },
      { id: second.userId, role: "user" },
    ]);
  });

  it("is invite-only after the first user by default", async () => {
    const { auth } = await setup();
    await signUp(auth, "admin@example.test");
    expect(await refusal(signUp(auth, "stranger@example.test"))).toBe(
      "invite_required"
    );
  });

  it("admits an invited address, which can then accept", async () => {
    const { auth, db } = await setup();
    const admin = await signUp(auth, "admin@example.test");
    const org = await auth.api.createOrganization({
      body: { name: "Acme", slug: "acme" },
      headers: admin.headers,
    });
    const invitation = await auth.api.createInvitation({
      body: {
        email: "Bob@Example.test",
        organizationId: org.id,
        role: "member",
      },
      headers: admin.headers,
    });

    const bob = await signUp(auth, "bob@example.test");
    await auth.api.acceptInvitation({
      body: { invitationId: invitation.id },
      headers: bob.headers,
    });

    const memberships = await db
      .select({ orgId: member.organizationId, role: member.role })
      .from(member)
      .where(eq(member.userId, bob.userId));
    expect(memberships).toContainEqual({ orgId: org.id, role: "member" });
  });

  it("limits `domain` sign-up to the allowlist, plus invitations", async () => {
    const { auth } = await setup({
      domains: ["corp.example"],
      signup: "domain",
    });
    const admin = await signUp(auth, "admin@elsewhere.test");
    await signUp(auth, "dev@corp.example");
    expect(await refusal(signUp(auth, "dev@other.example"))).toBe(
      "domain_not_allowed"
    );

    const org = await auth.api.createOrganization({
      body: { name: "Acme", slug: "acme" },
      headers: admin.headers,
    });
    await auth.api.createInvitation({
      body: {
        email: "guest@other.example",
        organizationId: org.id,
        role: "member",
      },
      headers: admin.headers,
    });
    await expect(signUp(auth, "guest@other.example")).resolves.toBeDefined();
  });

  it("lets anyone in under `open`", async () => {
    const { auth } = await setup({ signup: "open" });
    await signUp(auth, "one@example.test");
    await expect(signUp(auth, "two@example.test")).resolves.toBeDefined();
  });

  it("refuses password sign-up entirely under `sso`", async () => {
    // Better Auth fetches OIDC discovery at startup; tests never reach the
    // network, so the provider is simply skipped.
    vi.stubGlobal("fetch", () => Promise.reject(new Error("offline")));
    const { auth } = await setup({
      oidc: [
        {
          clientId: "id",
          clientSecret: "secret",
          id: "corp",
          issuer: "https://idp.example.test",
          name: "Corp",
        },
      ],
      signup: "sso",
    });
    expect(await refusal(signUp(auth, "first@example.test"))).toBe(
      "sso_required"
    );
  });
});

describe("personal orgs", () => {
  it("can't be deleted or invited into through Better Auth either", async () => {
    const { auth, db } = await setup();
    const ada = await signUp(auth, "ada@example.test");
    const [personal] = await db
      .select({ id: organization.id })
      .from(organization)
      .where(eq(organization.isPersonal, true));
    if (!personal) {
      throw new Error("no personal org");
    }

    expect(
      await refusal(
        auth.api.deleteOrganization({
          body: { organizationId: personal.id },
          headers: ada.headers,
        })
      )
    ).toBe("PERSONAL_ORG");
    expect(
      await refusal(
        auth.api.createInvitation({
          body: {
            email: "x@example.test",
            organizationId: personal.id,
            role: "member",
          },
          headers: ada.headers,
        })
      )
    ).toBe("PERSONAL_ORG");
  });
});

describe("invitations (the id is the invite capability)", () => {
  /** An admin, their org and a pending invitation for `email`. */
  const invited = async (auth: TestAuth["auth"], email: string) => {
    const admin = await signUp(auth, "admin@example.test");
    const org = await auth.api.createOrganization({
      body: { name: "Acme", slug: "acme" },
      headers: admin.headers,
    });
    const invitation = await auth.api.createInvitation({
      body: { email, organizationId: org.id, role: "member" },
      headers: admin.headers,
    });
    return { admin, invitation, org };
  };

  /** A request to the mounted Better Auth handler, as the shell serves it. */
  const overHttp = (
    auth: TestAuth["auth"],
    path: string,
    headers: Headers
  ): Promise<Response> =>
    auth.handler(
      new Request(`http://localhost:3000/api/auth${path}`, { headers })
    );

  it("mints random v4 ids, not time-ordered v7 ones", async () => {
    const { auth } = await setup({ signup: "open" });
    const { admin, invitation, org } = await invited(auth, "a@example.test");
    const second = await auth.api.createInvitation({
      body: { email: "b@example.test", organizationId: org.id, role: "member" },
      headers: admin.headers,
    });
    for (const id of [invitation.id, second.id]) {
      expect(id).toMatch(UUID_V4);
      expect(idTimestamp(id)).toBeUndefined();
    }
    expect(second.id).not.toBe(invitation.id);
    // Everything else keeps UUIDv7 (ticket 008).
    expect(idTimestamp(org.id)).toBeInstanceOf(Date);
    expect(idTimestamp(admin.userId)).toBeInstanceOf(Date);
  });

  it("never lists or shows an invitation over Better Auth's HTTP routes", async () => {
    const { auth } = await setup();
    const { admin, invitation, org } = await invited(auth, "bob@example.test");
    // Someone who signed up with the invited address but has no link.
    const squatter = await signUp(auth, "bob@example.test");

    const probes = [
      [squatter, "/organization/list-user-invitations"],
      [squatter, "/organization/list-user-invitations/"],
      [squatter, `/organization/get-invitation?id=${invitation.id}`],
      [admin, `/organization/list-invitations?organizationId=${org.id}`],
      [admin, `/organization/get-full-organization?organizationId=${org.id}`],
      [admin, "/organization/list"],
    ] as const;
    const statuses = await Promise.all(
      probes.map(async ([who, path]) => ({
        path,
        status: (await overHttp(auth, path, who.headers)).status,
      }))
    );
    expect(statuses).toEqual(probes.map(([, path]) => ({ path, status: 404 })));
    // The handler itself is live: the session route still answers.
    const session = await overHttp(auth, "/get-session", squatter.headers);
    expect(session.status).toBe(200);
  });

  it("still accepts server-side for the right address, never for another", async () => {
    const { auth, db } = await setup({ signup: "open" });
    const { invitation, org } = await invited(auth, "bob@example.test");
    const eve = await signUp(auth, "eve@example.test");
    expect(
      await refusal(
        auth.api.acceptInvitation({
          body: { invitationId: invitation.id },
          headers: eve.headers,
        })
      )
    ).toBe("YOU_ARE_NOT_THE_RECIPIENT_OF_THE_INVITATION");

    const bob = await signUp(auth, "bob@example.test");
    await auth.api.acceptInvitation({
      body: { invitationId: invitation.id },
      headers: bob.headers,
    });
    const memberships = await db
      .select({ orgId: member.organizationId })
      .from(member)
      .where(eq(member.userId, bob.userId));
    expect(memberships).toContainEqual({ orgId: org.id });
  });
});

describe("createAuth", () => {
  it("falls back to a dev secret with a warning outside production", async () => {
    const { config, db } = await setup();
    const warnings: string[] = [];
    const result = createAuth({
      config,
      db,
      env: {},
      log: { warn: (message) => warnings.push(message) },
    });
    expect(result.ok).toBe(true);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("BETTER_AUTH_SECRET");
    expect(warnings[0]).not.toContain(DEV_ONLY_SECRET);
  });

  it("stays off in production without a secret", async () => {
    const { config, db } = await setup();
    const result = createAuth({
      config,
      db,
      env: { NODE_ENV: "production" },
      log: { warn: () => undefined },
    });
    expect(result).toEqual({ error: { type: "missing_secret" }, ok: false });
  });
});

describe("client addresses (044)", () => {
  /** Signs up over the mounted handler, as a browser behind proxies would. */
  const signUpOverHttp = (
    auth: TestAuth["auth"],
    email: string,
    headers: Record<string, string>
  ) =>
    auth.handler(
      new Request("http://localhost:3000/api/auth/sign-up/email", {
        body: JSON.stringify({
          email,
          name: "Pat",
          password: "correct-horse-battery",
        }),
        headers: {
          "content-type": "application/json",
          origin: "http://localhost:3000",
          ...headers,
        },
        method: "POST",
      })
    );

  const sessionAddress = async (db: TestAuth["db"], email: string) => {
    const [row] = await db
      .select({ ipAddress: sessionTable.ipAddress })
      .from(sessionTable)
      .innerJoin(user, eq(user.id, sessionTable.userId))
      .where(eq(user.email, email));
    return row?.ipAddress ?? null;
  };

  it("records the last hop, not what the client wrote, without trusted proxies", async () => {
    const { auth, db } = await setup({ signup: "open" });
    const response = await signUpOverHttp(auth, "pat@example.test", {
      "x-forwarded-for": "198.51.100.1, 203.0.113.9",
      "x-resolved-client-address": "192.0.2.77",
    });
    expect(response.status).toBe(200);
    expect(await sessionAddress(db, "pat@example.test")).toBe("203.0.113.9");
  });

  it("walks past TRUSTED_PROXIES to the client", async () => {
    const testDb = await createTestDb();
    const created = createAuth({
      config: appConfigSchema.parse({ auth: { signup: "open" } }),
      db: testDb.db,
      env: {
        BETTER_AUTH_SECRET: "test-secret-0123456789abcdefghijklmnop",
        TRUSTED_PROXIES: "10.0.0.0/8, 127.0.0.1",
      },
      log: { warn: () => undefined },
    });
    if (!created.ok) {
      throw new Error(created.error.type);
    }
    try {
      const response = await signUpOverHttp(created.value, "sam@example.test", {
        "x-forwarded-for": "198.51.100.1, 203.0.113.9, 10.0.0.4, 127.0.0.1",
      });
      expect(response.status).toBe(200);
      expect(await sessionAddress(testDb.db, "sam@example.test")).toBe(
        "203.0.113.9"
      );
    } finally {
      await testDb.close();
    }
  });

  it("warns about entries it can't use", () => {
    const warn = vi.fn();
    createAuth({
      config: appConfigSchema.parse({}),
      db: {} as TestAuth["db"],
      env: {
        BETTER_AUTH_SECRET: "x".repeat(40),
        TRUSTED_PROXIES: "10.0.0.0/8,lb.internal",
      },
      log: { warn },
    });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("lb.internal"));
  });
});

describe("trusted origins (054)", () => {
  /** A server with `env` over a fresh database; closed after the test. */
  const serverWith = async (env: Record<string, string>) => {
    const testDb = await createTestDb();
    const warn = vi.fn();
    const created = createAuth({
      config: appConfigSchema.parse({ auth: { signup: "open" } }),
      db: testDb.db,
      env: {
        BETTER_AUTH_SECRET: "test-secret-0123456789abcdefghijklmnop",
        ...env,
      },
      log: { warn },
    });
    if (!created.ok) {
      throw new Error(created.error.type);
    }
    return { auth: created.value, testDb, warn };
  };

  /** A browser's sign-up from `origin`, to the server at the same address. */
  const signUpFrom = (auth: TestAuth["auth"], origin: string, email: string) =>
    auth.handler(
      new Request(`${origin}/api/auth/sign-up/email`, {
        body: JSON.stringify({
          email,
          name: "Pat",
          password: "correct-horse-battery",
        }),
        headers: { "content-type": "application/json", origin },
        method: "POST",
      })
    );

  it("lets the other loopback names in when BETTER_AUTH_URL is one", async () => {
    const { auth, testDb } = await serverWith({
      BETTER_AUTH_URL: "http://localhost:3000",
    });
    try {
      for (const [origin, email] of [
        ["http://127.0.0.1:3000", "a@example.test"],
        ["http://[::1]:3000", "b@example.test"],
      ] as const) {
        // biome-ignore lint/performance/noAwaitInLoops: one database, in turn.
        const response = await signUpFrom(auth, origin, email);
        expect(response.status, origin).toBe(200);
      }
      // Another port is another app.
      const elsewhere = await signUpFrom(
        auth,
        "http://127.0.0.1:4000",
        "c@example.test"
      );
      expect(elsewhere.status).toBe(403);
      expect(await elsewhere.json()).toMatchObject({ code: "INVALID_ORIGIN" });
    } finally {
      await testDb.close();
    }
  });

  it("keeps a public BETTER_AUTH_URL exact, plus TRUSTED_ORIGINS", async () => {
    const { auth, testDb, warn } = await serverWith({
      BETTER_AUTH_URL: "https://chat.example.com",
      TRUSTED_ORIGINS: "https://chat.example.org, https://*.example.net",
    });
    try {
      const loopback = await signUpFrom(
        auth,
        "http://127.0.0.1:3000",
        "a@example.test"
      );
      expect(loopback.status).toBe(403);
      const listed = await signUpFrom(
        auth,
        "https://chat.example.org",
        "b@example.test"
      );
      expect(listed.status).toBe(200);
      // The wildcard entry is ignored, with a warning, not matched.
      const patterned = await signUpFrom(
        auth,
        "https://evil.example.net",
        "c@example.test"
      );
      expect(patterned.status).toBe(403);
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining("https://*.example.net")
      );
    } finally {
      await testDb.close();
    }
  });

  it("warns that BETTER_AUTH_TRUSTED_ORIGINS goes unchecked", async () => {
    const { testDb, warn } = await serverWith({
      BETTER_AUTH_TRUSTED_ORIGINS: "https://chat.example.org",
    });
    await testDb.close();
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("TRUSTED_ORIGINS instead")
    );
  });
});
