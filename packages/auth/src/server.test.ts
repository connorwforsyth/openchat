import { member, organization, user } from "@workspace/db/schema/auth";
import { isAPIError } from "better-auth/api";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DEV_ONLY_SECRET } from "./env";
import { createAuth } from "./server";
import { createTestAuth, signUp, type TestAuth } from "./testing";

let current: TestAuth | undefined;

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
